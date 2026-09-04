import { AgentController, type Session } from "@mastra/core/agent-controller";
import { Mastra } from "@mastra/core/mastra";
import { MastraServer } from "@mastra/hono";
import { Hono, type Context } from "hono";
import { streamSSE } from "hono/streaming";
import { z } from "zod";
import { addressSchema, routeStatePatchSchema } from "@pe/agent-contracts";
import { readThreadState, toWireDisplayState } from "./thread-state.ts";
import {
  RouteWorkspace,
  type RouteWorkspaceRegistration,
  type RouteWorkspaceScope,
} from "./route-workspace.ts";

/* ── Route-state dispatcher request bodies ─────────────────────────────────── */

const routeStateApplyBodySchema = z.object({
  patches: z.array(routeStatePatchSchema),
  expectedRevision: z.number().int().nonnegative(),
});
const routeStateCommandBodySchema = z.object({
  command: z.string(),
  input: z.unknown().optional(),
  expectedRevision: z.number().int().nonnegative(),
  requestId: z.string().trim().min(1).optional(),
});

export interface ServableRuntime {
  controller: AgentController;
  resourceId: string;
  session?: Session;
  mastra?: Mastra;
  storage?: unknown;
  metadata?: Record<string, unknown>;
  isSessionAdmitted?(session: Session): boolean;
  close?: () => Promise<void> | void;
  /** mastra code-sdk `AuthStorage` (auth.json): the one credential store Pea reads. */
  authStorage?: {
    setStoredApiKey(provider: string, key: string, envVar?: string): void;
    hasStoredApiKey(provider: string): boolean;
    isLoggedIn(provider: string): boolean;
  };
}

/** mastra keys OpenAI credentials under its Codex OAuth id; stored keys must land in the same slot. */
const authProviderId = (provider: string) => (provider === "openai" ? "openai-codex" : provider);

function resolveServingTarget(runtime: ServableRuntime, label: string): Mastra {
  const existing = runtime.mastra ?? runtime.controller.getMastra();
  if (existing) {
    for (const value of Object.values(existing.listAgentControllers())) {
      if (value === runtime.controller) return existing;
    }
  }
  // Mastracode's Mastra does not list its controllers, so the server wraps them under the label.
  return new Mastra({
    agentControllers: { [label]: runtime.controller },
    ...(runtime.storage ? { storage: runtime.storage as never } : {}),
  });
}

export interface BuildAgentControllerAppOptions {
  runtime: ServableRuntime;
  label: string;
  routeRegistrations?: readonly RouteWorkspaceRegistration[];
}

export async function buildAgentControllerApp(
  options: BuildAgentControllerAppOptions,
): Promise<Hono> {
  const runtime = options.runtime;
  const mastra = resolveServingTarget(runtime, options.label);
  const resourceId = runtime.resourceId;

  const app = new Hono();
  const openSession = (threadId: string) =>
    runtime.controller.createSession({ resourceId, scope: threadId, threadId });
  // Display state is session-lifetime and never in the thread body; the stream is its only
  // source, so every (re)attach opens with one snapshot frame ahead of mastra's live events.
  app.use("/api/agent-controller/:controllerId/sessions/:resourceId/stream", async (c, next) => {
    const scope = c.req.query("sessionScope");
    const snapshot = scope
      ? `data: ${JSON.stringify({
          type: "display_state_changed",
          displayState: toWireDisplayState((await openSession(scope)).displayState.get()),
        })}

`
      : null;
    await next();
    if (!snapshot || !c.res.body) return;
    const body = c.res.body.pipeThrough(
      new TransformStream({ start: (ctl) => ctl.enqueue(new TextEncoder().encode(snapshot)) }),
    );
    c.res = new Response(body, c.res);
  });
  // Native display state omits Pe prompt, tool, skill, and OM metadata.
  app.get("/pe/inspect", (c) => c.json((runtime.metadata?.workbench as unknown) ?? {}));
  app.get("/pe/thread/:threadId", async (c) => {
    const threadId = c.req.param("threadId");
    try {
      return c.json(await readThreadState(runtime, await openSession(threadId), threadId));
    } catch (error) {
      return c.json({ error: errorMessage(error) }, 500);
    }
  });
  // Paste-a-key: writes auth.json, then drops the 10s catalog cache so the next snapshot sees it.
  app.post("/pe/credentials/:provider", async (c) => {
    const provider = c.req.param("provider");
    const body = (await c.req.json().catch(() => ({}))) as { apiKey?: string };
    const apiKey = body.apiKey?.trim();
    if (!runtime.authStorage) return c.json({ error: "no credential store" }, 503);
    if (!apiKey) return c.json({ error: "apiKey required" }, 400);
    runtime.authStorage.setStoredApiKey(authProviderId(provider), apiKey);
    (
      runtime.controller as { invalidateAvailableModelsCache?: () => void }
    ).invalidateAvailableModelsCache?.();
    return c.json({ ok: true });
  });
  const registrations = options.routeRegistrations ?? [];
  const storage = mastra.getStorage();
  const threadState = await storage?.getStore("threadState");
  if (registrations.length > 0 && !threadState)
    throw new Error("RouteWorkspace requires the native threadState store.");

  const routeWorkspace = new RouteWorkspace({
    registrations,
    store: {
      getState: ({ documentAddress, route }) =>
        threadState!.getState({
          threadId: resourceId,
          type: routeDocumentKey(documentAddress, route),
        }),
      setState: ({ documentAddress, route, value }) =>
        threadState!.setState({
          threadId: resourceId,
          type: routeDocumentKey(documentAddress, route),
          value,
        }),
    },
  });

  // Discovery is unscoped; every document read or write must name one scope.
  app.get("/pe/route-state", (c) => c.json(routeWorkspace.list()));
  app.get("/pe/route-state/:route", async (c) => {
    const scope = scopeOr400(c, "read");
    if (scope instanceof Response) return scope;
    try {
      const view = await routeWorkspace.read(scope, c.req.param("route"));
      return view
        ? c.json(view)
        : c.json({ error: `unknown route '${c.req.param("route")}'` }, 404);
    } catch (error) {
      return c.json({ error: errorMessage(error) }, 403);
    }
  });
  app.get("/pe/route-state/:route/events", async (c) => {
    const scope = scopeOr400(c, "read");
    if (scope instanceof Response) return scope;
    const route = c.req.param("route");
    try {
      if (!(await routeWorkspace.read(scope, route)))
        return c.json({ error: `unknown route '${route}'` }, 404);
    } catch (error) {
      return c.json({ error: errorMessage(error) }, 403);
    }
    return streamRouteWorkspace(c, routeWorkspace, scope, route);
  });
  const writes = [
    {
      suffix: "apply",
      schema: routeStateApplyBodySchema,
      hint: "expected { patches, expectedRevision }",
      run: (scope: RouteWorkspaceScope, route: string, actor: "agent" | "human", data: unknown) => {
        const body = data as z.infer<typeof routeStateApplyBodySchema>;
        return routeWorkspace.apply(scope, route, actor, body.patches, body.expectedRevision);
      },
    },
    {
      suffix: "command",
      schema: routeStateCommandBodySchema,
      hint: "expected { command, input?, expectedRevision, requestId? }",
      run: (scope: RouteWorkspaceScope, route: string, actor: "agent" | "human", data: unknown) => {
        const body = data as z.infer<typeof routeStateCommandBodySchema>;
        return routeWorkspace.command(
          scope,
          route,
          actor,
          body.command,
          body.input,
          body.expectedRevision,
          body.requestId,
        );
      },
    },
  ] as const;
  const mountRouteStateWrites = (prefix: string, actor: "agent" | "human") => {
    for (const write of writes)
      app.post(`${prefix}/:route/${write.suffix}`, async (c) => {
        const scope = scopeOr400(c, "write");
        if (scope instanceof Response) return scope;
        const parsed = write.schema.safeParse(await c.req.json().catch(() => null));
        if (!parsed.success)
          return c.json({ ok: false, kind: "error", error: "invalid body", hint: write.hint }, 400);
        try {
          return c.json(await write.run(scope, c.req.param("route"), actor, parsed.data));
        } catch (error) {
          return c.json(
            {
              ok: false,
              kind: "error",
              error: errorMessage(error),
              hint: "re-read the document before retrying.",
            },
            403,
          );
        }
      });
  };
  mountRouteStateWrites("/pe/route-state", "human");
  mountRouteStateWrites("/pe/agent/route-state", "agent");

  const server = new MastraServer({ app: app as never, mastra });
  await server.init();
  return app;
}

function scopeOr400(c: Context, shape: "read" | "write"): RouteWorkspaceScope | Response {
  const parsed = addressSchema.safeParse(c.req.query("doc")?.trim());
  if (parsed.success) return { documentAddress: parsed.data };
  return c.json(
    shape === "read"
      ? { error: "route scope is required", hint: "doc required" }
      : { ok: false, kind: "error", error: "route scope is required", hint: "doc required" },
    400,
  );
}

function streamRouteWorkspace(
  c: Context,
  workspace: RouteWorkspace,
  scope: RouteWorkspaceScope,
  route: string,
) {
  return streamSSE(c, async (stream) => {
    let aborted = false;
    let dirty = true;
    let wake: (() => void) | undefined;
    const notify = () => {
      dirty = true;
      wake?.();
      wake = undefined;
    };
    const unsubscribe = workspace.subscribe((event) => {
      if (event.route === route && event.scope.documentAddress === scope.documentAddress) notify();
    });
    stream.onAbort(() => {
      aborted = true;
      notify();
    });

    try {
      while (!aborted) {
        if (!dirty) await new Promise<void>((resolve) => (wake = resolve));
        if (aborted) break;
        dirty = false;
        const view = await workspace.read(scope, route);
        if (view) await stream.writeSSE({ data: JSON.stringify(view) });
      }
    } finally {
      unsubscribe();
    }
  });
}

function routeDocumentKey(documentAddress: string, route: string): string {
  // ponytail: KV keyed by string on resourceId; use a document table only for enumeration or scope-delete.
  return `${route}:${documentAddress}`;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
