import type { MastraCompositeStore } from "@mastra/core/storage";
import {
  addressSchema,
  bindWork,
  documentRefSchema,
  type CapabilityCatalog,
  type WorkKey,
  familiesViewSchema,
  familiesViewCommandSchema,
  familiesViewAckSchema,
} from "@pe/agent-contracts";
import { AgentController, type Session } from "@mastra/core/agent-controller";
import { Mastra } from "@mastra/core/mastra";
import { MastraServer } from "@mastra/hono";
import { Hono, type Context } from "hono";
import { observeResources, resourceResponse, type ResourceObserver } from "./resource-stream.ts";
import { z } from "zod";
import {
  putTargetSchema,
  routeStatePatchSchema,
  START_FRESH,
  type PutTargetResult,
} from "@pe/agent-contracts";
import type { ScopeStore } from "./scope-store.ts";
import { readThreadState, readToolResult, toWireDisplayState } from "./thread-state.ts";
import { RouteWorkspace, type RouteWorkspaceRegistration } from "./route-workspace.ts";
import { turnQueues } from "./turn-queue.ts";
import { RouteViewStore } from "./route-view-store.ts";
import { readingKey } from "@pe/agent-contracts";

/* ── Route-state dispatcher request bodies ─────────────────────────────────── */

const routeStateApplyBodySchema = z.object({
  patches: z.array(routeStatePatchSchema),
  expectedRevision: z.number().int().nonnegative(),
});
const routeStateCommandBodySchema = z.object({
  command: z.string(),
  input: z.unknown().optional(),
  expectedRevision: z.number().int().nonnegative(),
});

export interface ServableRuntime {
  controller: AgentController;
  resourceId: string;
  session?: Session;
  mastra?: Mastra;
  storage?: unknown;
  /** The one Scope per thread; every turn is admitted under its current revision. */
  scopes: ScopeStore;
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
  onRouteWorkspace?: (workspace: RouteWorkspace, storage: MastraCompositeStore | undefined) => void;
  observeHostResource?: ResourceObserver;
  /** Wraps every served Reading, Work included, e.g. with the host's document change mark. */
  markReadings?: (observe: ResourceObserver) => ResourceObserver;
  /** The one capability catalog, read for a bridge selector; served at GET /pe/capabilities. */
  capabilityCatalog?: { read(bridgeSelector?: string): Promise<CapabilityCatalog> };
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
  app.get("/pe/thread/:threadId/queue", async (c) => {
    const queue = turnQueues.get(await openSession(c.req.param("threadId")));
    return c.json(queue?.read() ?? { items: [], paused: false });
  });
  app.put("/pe/thread/:threadId/queue", async (c) => {
    const command = z
      .discriminatedUnion("action", [
        z.object({ action: z.literal("resume") }),
        z.object({ action: z.literal("remove"), id: z.string().min(1) }),
        z.object({
          action: z.literal("edit"),
          id: z.string().min(1),
          content: z.string().trim().min(1),
        }),
      ])
      .safeParse(await c.req.json().catch(() => null));
    if (!command.success) return c.json({ error: "Invalid queue command" }, 400);
    const queue = turnQueues.get(await openSession(c.req.param("threadId")));
    if (!queue) return c.json({ error: "Queue unavailable" }, 503);
    try {
      await queue.change(command.data);
      return c.json(queue.read());
    } catch (error) {
      return c.json({ error: errorMessage(error) }, 409);
    }
  });
  app.get("/pe/thread/:threadId/tool-result/:messageId/:toolCallId", async (c) => {
    const threadId = c.req.param("threadId");
    try {
      const result = await readToolResult(
        runtime,
        threadId,
        c.req.param("messageId"),
        c.req.param("toolCallId"),
      );
      return c.json(result.body, result.status);
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
  // The ONE endpoint pair for the thread head: read (or watch with ?watch) and set. A set while pea
  // is mid-turn is refused unless it comes from that turn itself, and the
  // new revision applies to the next turn; the running turn keeps the revision it was admitted under.
  app.get("/pe/scope/:threadId", async (c) => {
    const threadId = c.req.param("threadId");
    return c.json(await runtime.scopes.read(threadId));
  });
  app.put("/pe/scope/:threadId", async (c) => {
    const threadId = c.req.param("threadId");
    const parsed = putTargetSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success)
      return c.json(
        {
          error: "invalid body",
          hint: "expected { defaultTarget: { kind, ... } | null, expectedRevision, turn? }",
        },
        400,
      );
    const session = await openSession(threadId);
    const result: PutTargetResult = await runtime.scopes.set(
      threadId,
      parsed.data.defaultTarget,
      parsed.data.expectedRevision,
      () => {
        const admitted = runtime.scopes.admittedTurn(threadId);
        return (session.run.isRunning() || runtime.scopes.admissionPending(threadId)) &&
          (!admitted || parsed.data.turn !== admitted)
          ? { ok: false, why: "in-turn" }
          : undefined;
      },
    );
    return c.json(result, result.ok ? 200 : 409);
  });
  // The one capability catalog (ops, route docs and commands, pods, skills), keyed by the same
  // Work key query as a route document: ?target=<address>, or neither.
  app.get("/pe/capabilities", async (c) => {
    if (!options.capabilityCatalog) return c.json({ error: "no capability catalog" }, 503);
    const scope = scopeOr400(c, "read");
    if (scope instanceof Response) return scope;
    try {
      const selector =
        c.req.query("session") ?? (scope.target !== null ? `doc:${scope.target}` : undefined);
      return c.json(
        // TODO(fold-2): the catalogue should take the ExecutionTarget from resolveCallTarget
        // instead of a selector string; no inventory is in hand here.
        await options.capabilityCatalog.read(selector),
      );
    } catch (error) {
      return c.json({ error: errorMessage(error) }, 502);
    }
  });
  const registrations = options.routeRegistrations ?? [];
  const storage = mastra.getStorage();
  const threadState = await storage?.getStore("threadState");
  if (registrations.length > 0 && !threadState)
    throw new Error("RouteWorkspace requires the native threadState store.");

  const routeWorkspace = new RouteWorkspace({
    registrations,
    store: {
      getState: ({ targetKey, route }) =>
        threadState!.getState({ threadId: resourceId, type: routeDocumentKey(targetKey, route) }),
      setState: ({ targetKey, route, value }) =>
        threadState!.setState({
          threadId: resourceId,
          type: routeDocumentKey(targetKey, route),
          value,
        }),
    },
  });

  options.onRouteWorkspace?.(routeWorkspace, storage);
  const resources = observeResources(routeWorkspace, runtime.scopes, options.observeHostResource);
  const views = new RouteViewStore();
  const observeBase = options.markReadings ? options.markReadings(resources) : resources;
  const observe: ResourceObserver = (request, publish) => {
    const release = observeBase(request, publish);
    if (request.kind !== "world") return release;
    const releaseViews = views.subscribe((intent) =>
      publish({ kind: "event", key: readingKey(request), value: intent }),
    );
    return () => {
      releaseViews();
      release();
    };
  };
  app.get("/pe/resources", (c) => resourceResponse(c.req.raw, observe));

  app.put("/pe/route-view/families", async (c) => {
    const parsed = familiesViewSchema.safeParse(await c.req.json().catch(() => null));
    return parsed.success
      ? c.json(views.publish(parsed.data))
      : c.json({ error: "invalid Families view" }, 400);
  });
  app.delete("/pe/route-view/families/:instance", (c) => {
    views.remove(c.req.param("instance"));
    return c.json({ ok: true });
  });
  app.get("/pe/route-view/families", (c) => {
    const thread = c.req.query("thread");
    if (!thread) return c.json({ error: "thread required" }, 400);
    const result = views.select(thread, c.req.query("instance"));
    return result && !("ok" in result)
      ? c.json(result)
      : c.json(result ?? { ok: false, error: "view unavailable" }, 409);
  });
  app.post("/pe/route-view/families/set-query", async (c) => {
    const parsed = familiesViewCommandSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ ok: false, error: "invalid Families query command" }, 400);
    const result = await views.setQuery(
      parsed.data.thread,
      parsed.data.instance,
      parsed.data.revision,
      parsed.data.query,
    );
    return c.json(result, (result as { ok: boolean }).ok ? 200 : 409);
  });
  app.post("/pe/route-view/families/ack", async (c) => {
    const parsed = familiesViewAckSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ ok: false, error: "invalid Families view ack" }, 400);
    const result = views.ack(parsed.data);
    return c.json(result, result.ok ? 200 : 409);
  });

  // Discovery is unscoped; every document read or write names one route scope: a chat Scope
  // (?target=<address>, or neither) or a standalone ?work=<id>.
  app.get("/pe/route-state", (c) => c.json(routeWorkspace.list()));
  app.get("/pe/route-state/:route", async (c) => {
    const scope = scopeOr400(c, "read");
    if (scope instanceof Response) return scope;
    try {
      const view = await routeWorkspace.view(scope, c.req.param("route"));
      return view
        ? c.json(view)
        : c.json({ error: `unknown route '${c.req.param("route")}'` }, 404);
    } catch (error) {
      return c.json({ error: errorMessage(error) }, 403);
    }
  });
  // Human-only and read-only; the agent prefix is mounted so it is refused by name, not 404.
  for (const [prefix, actor] of [
    ["/pe/route-state", "human"],
    ["/pe/agent/route-state", "agent"],
  ] as const)
    app.get(`${prefix}/:route/salvage`, async (c) => {
      const scope = scopeOr400(c, "read");
      if (scope instanceof Response) return scope;
      const route = c.req.param("route");
      const salvaged = await routeWorkspace.salvage(scope, route, actor);
      if (!salvaged) return c.json({ error: `nothing to salvage on '${route}'` }, 404);
      return "ok" in salvaged ? c.json(salvaged, 403) : c.json(salvaged);
    });
  const writes = [
    {
      suffix: "apply",
      schema: routeStateApplyBodySchema,
      hint: "expected { patches, expectedRevision }",
      run: (scope: WorkKey, route: string, actor: "agent" | "human", data: unknown) => {
        const body = data as z.infer<typeof routeStateApplyBodySchema>;
        return routeWorkspace.apply(scope, route, actor, body.patches, body.expectedRevision);
      },
    },
    {
      suffix: "command",
      schema: routeStateCommandBodySchema,
      hint: "expected { command, input?, expectedRevision }",
      run: (scope: WorkKey, route: string, actor: "agent" | "human", data: unknown) => {
        const body = data as z.infer<typeof routeStateCommandBodySchema>;
        return routeWorkspace.command(
          scope,
          route,
          actor,
          body.command,
          body.input,
          body.expectedRevision,
        );
      },
    },
    {
      // Mounted under both prefixes; the agent door is refused by startFresh itself.
      suffix: START_FRESH,
      schema: z.object({}),
      hint: "expected {}",
      run: (scope: WorkKey, route: string, actor: "agent" | "human") =>
        routeWorkspace.startFresh(scope, route, actor),
    },
  ] as const;
  const mountRouteStateWrites = (prefix: string, actor: "agent" | "human") => {
    for (const write of writes)
      app.post(`${prefix}/:route/${write.suffix}`, async (c) => {
        const scope = scopeOr400(c, "write");
        if (scope instanceof Response) return scope;
        const parsed = write.schema.safeParse(await c.req.json().catch(() => null));
        if (!parsed.success) {
          // Name the first failing field and the schema's word for its shape.
          const issue = parsed.error.issues[0]!;
          const field = issue.path
            .map((key) => (typeof key === "number" ? `[${key}]` : `.${String(key)}`))
            .join("")
            .replace(/^\./, "");
          const error = `invalid body at ${field || "the body"}: ${issue.message}`;
          return c.json({ ok: false, kind: "error", error, hint: write.hint }, 400);
        }
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

/**
 * The WorkKey a request names: `?work=<id>` for a standalone workspace, `?target=<address>` for
 * document-scoped Work, neither for the host-only Work. Work keys by Address (law 6), so an
 * `open` request is resolved to its Address by the caller before it reaches here.
 */
function scopeOr400(c: Context, shape: "read" | "write"): WorkKey | Response {
  const route = c.req.param("route") ?? "";
  const work = c.req.query("work")?.trim();
  const target = c.req.query("target")?.trim() || null;
  const invalid = (error: string) =>
    c.json(shape === "read" ? { error } : { ok: false, kind: "error", error, hint: error }, 400);
  if (work) {
    if (target || work.length > 200) return invalid("Provide exactly one Work key");
    return bindWork(route, null, work);
  }
  // `open=<session>/<openId>`: the exact document lifetime. Alone it keys an unsaved document's
  // ephemeral Work; beside a Target it is what a Save As migration carries over from.
  const open = c.req.query("open")?.trim();
  let ref: { session: string; openId: string } | undefined;
  if (open) {
    const cut = open.indexOf("/");
    const parsed = documentRefSchema.safeParse({
      session: open.slice(0, Math.max(cut, 0)),
      openId: open.slice(cut + 1),
    });
    if (cut < 1 || !parsed.success)
      return invalid("invalid open document: expected <session>/<openId>");
    ref = parsed.data;
  }
  const scope = (target: WorkKey["target"]): WorkKey => bindWork(route, target, undefined, ref);
  if (!target) return scope(null);
  const parsed = addressSchema.safeParse(target);
  if (!parsed.success) return invalid("invalid Target: expected a document Address");
  return scope(parsed.data);
}

function routeDocumentKey(targetKey: string, route: string): string {
  // ponytail: KV keyed by string on resourceId; use a document table only for enumeration or scope-delete.
  return `${route}:${targetKey}`;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
