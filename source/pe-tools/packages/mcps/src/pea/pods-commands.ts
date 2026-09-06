import {
  bridgeSelector,
  scopeDocument,
  scopeSession,
  type PodsDocument,
  type ResolvedTarget,
  type RouteStateCommandHandlers,
  type Scope,
} from "@pe/agent-contracts";

import { resolveHostBaseUrl, resolveWorkspaceKey } from "../shared/host-config.ts";
import { HostRpcCaller } from "../shared/host-rpc-caller.ts";
import { ScriptingTools, scriptClientTimeoutMs } from "../shared/scripting.ts";

type PermissionMode = "ReadOnly" | "WriteTransaction" | "NoTransaction";

/**
 * The `pods` route is the ONE door to scripting. `run` presses a declared entrypoint — the same
 * thing the user presses in the Do palette — and every receipt names the session it ran in and the
 * document that session had active, so the browser shows what the run actually touched. The
 * session is the Scope the document is keyed under; no command names one.
 */
export function createPodsCommandHandlers(
  options: { hostBaseUrl?: string; workspaceKey?: string } = {},
): RouteStateCommandHandlers<PodsDocument> {
  const hostBaseUrl = resolveHostBaseUrl(options.hostBaseUrl);
  const caller = (scope: Scope, timeoutMs?: number) =>
    new HostRpcCaller({ hostBaseUrl, bridgeSessionId: bridgeSelector(scope), timeoutMs });
  const tools = (scope: Scope, timeoutMs?: number) =>
    new ScriptingTools(caller(scope, timeoutMs), {
      workspaceKey: resolveWorkspaceKey(options.workspaceKey),
    });

  /** The session the host resolved for this Scope, plus the document it actually has active. */
  const resolve = async (scope: Scope): Promise<ResolvedTarget> => {
    const summary = await caller(scope).call("bridge.sessions.summary");
    return {
      session: summary.sdkSessionId ?? summary.sessionId ?? scopeSession(scope),
      document: summary.activeDocument?.path ?? scopeDocument(scope),
    };
  };

  const receipt = async (
    ctx: { scope: Scope; getDoc(): PodsDocument; setDoc(next: PodsDocument): Promise<void> },
    command: string,
    entrypoint: string | null,
    run: (doc: PodsDocument) => Promise<unknown>,
  ) => {
    const doc = ctx.getDoc();
    const target = await resolve(ctx.scope);
    const value = asJson(await run(doc));
    doc.receipt = { command, at: new Date().toISOString(), target, entrypoint, value };
    await ctx.setDoc(doc);
    return doc.receipt;
  };

  const workspaceOf = (doc: PodsDocument, given?: string) => {
    const key = given ?? doc.workspaceKey;
    return key ? { workspaceKey: key } : {};
  };

  return {
    refresh: async (_input, ctx) => {
      const doc = ctx.getDoc();
      doc.pods = { at: new Date().toISOString(), value: asJson(await tools(ctx.scope).listPods()) };
      await ctx.setDoc(doc);
      return doc.pods;
    },

    bootstrap: (input, ctx) => {
      const args = input as { workspaceKey?: string };
      return receipt(ctx, "bootstrap", null, (doc) =>
        tools(ctx.scope).bootstrap(workspaceOf(doc, args.workspaceKey)),
      );
    },

    run: (input, ctx) => {
      const args = input as {
        entrypoint: string;
        workspaceKey?: string;
        permissionMode?: PermissionMode;
        timeoutSeconds?: number;
      };
      return receipt(ctx, "run", args.entrypoint, async (doc) => {
        const scripting = tools(ctx.scope, scriptClientTimeoutMs(args.timeoutSeconds));
        const workspace = workspaceOf(doc, args.workspaceKey);
        // The entrypoint id is what the catalog row and the Do palette name; pod.json owns its path.
        const pods = await scripting.listPods();
        const sourcePath = pods.pods
          .find((pod) => pod.workspaceKey === (workspace.workspaceKey ?? pod.workspaceKey))
          ?.manifest?.entrypoints.find((entry) => entry.id === args.entrypoint)?.sourcePath;
        if (!sourcePath)
          throw new Error(`No declared entrypoint '${args.entrypoint}' in this pod.`);
        return scripting.execute({
          sourcePath,
          ...workspace,
          ...(args.permissionMode ? { permissionMode: args.permissionMode } : {}),
          ...(args.timeoutSeconds ? { timeoutSeconds: args.timeoutSeconds } : {}),
        });
      });
    },

    execute: (input, ctx) => {
      const args = input as {
        scriptContent: string;
        sourceName?: string;
        workspaceKey?: string;
        permissionMode?: PermissionMode;
        timeoutSeconds?: number;
      };
      return receipt(ctx, "execute", null, (doc) =>
        tools(ctx.scope, scriptClientTimeoutMs(args.timeoutSeconds)).execute({
          scriptContent: args.scriptContent,
          ...(args.sourceName ? { sourceName: args.sourceName } : {}),
          ...workspaceOf(doc, args.workspaceKey),
          ...(args.permissionMode ? { permissionMode: args.permissionMode } : {}),
          ...(args.timeoutSeconds ? { timeoutSeconds: args.timeoutSeconds } : {}),
        }),
      );
    },
  };
}

/** Route documents hold JSON; a host DTO is JSON once it has crossed the wire. */
function asJson(
  value: unknown,
): PodsDocument["pods"] extends infer T ? (T extends { value: infer V } ? V : never) : never {
  return JSON.parse(JSON.stringify(value ?? null)) as never;
}
