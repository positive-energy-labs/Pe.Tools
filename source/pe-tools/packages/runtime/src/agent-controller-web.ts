import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { AgentController, type Session } from "@mastra/core/agent-controller";
import { Mastra } from "@mastra/core/mastra";
import { MastraServer } from "@mastra/hono";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { z } from "zod";
import {
  applyRouteStatePatches,
  describeRouteState,
  listRouteStates,
  runRouteStateCommand,
  type RouteStateSession,
} from "./route-state-dispatch.ts";

/**
 * Body for the Pe send route. The native `/messages` route is `{ message: string }` only, so it
 * cannot carry attachments — but the in-process `Session.sendMessage` already accepts `files`
 * (base64 + mediaType), which reach the model as multimodal content. This route bridges that gap;
 * see MASTRA_UPSTREAM_CANDIDATES.md. Delete it once the native route carries `files`.
 */
const peSendMessageSchema = z.object({
  message: z.string(),
  files: z
    .array(
      z.object({
        data: z.string(),
        mediaType: z.string(),
        filename: z.string().optional(),
      }),
    )
    .optional(),
});

/* ── Route-state dispatcher request bodies ─────────────────────────────────── */

const routeStateActorSchema = z.enum(["agent", "human"]);
const routeStatePatchSchema = z.object({
  path: z.array(z.union([z.string(), z.number()])),
  value: z.unknown().optional(),
});
const routeStateApplyBodySchema = z.object({
  actor: routeStateActorSchema,
  patches: z.array(routeStatePatchSchema),
});
const routeStateCommandBodySchema = z.object({
  actor: routeStateActorSchema,
  command: z.string(),
  input: z.unknown().optional(),
});

/** The minimal shape we serve: an AgentController + its session, on a Mastra. */
export interface ServableRuntime {
  controller: AgentController;
  session?: Session;
  mastra?: Mastra;
  /** The controller's storage, shared with the wrap Mastra so thread routes resolve. */
  storage?: unknown;
  /** Pe-owned transparency payload (system prompt, tool list, skills, OM config). */
  metadata?: Record<string, unknown>;
  close?: () => Promise<void> | void;
}

/** Connection handshake the SPA reads to learn which controller/session to drive. */
interface PeWebInfo {
  controllerId: string;
  resourceId: string;
}

function requireServableRuntime(value: unknown): ServableRuntime {
  const runtime = value as Partial<ServableRuntime> | undefined;
  if (!(runtime?.controller instanceof AgentController)) {
    throw new Error("Runtime agent-controller web requires an AgentController.");
  }
  if (!runtime.session) {
    throw new Error("Runtime agent-controller web requires a session.");
  }
  return runtime as ServableRuntime;
}

/**
 * Resolve the Mastra to mount and the registration key the controller lives under
 * (route paths are `/api/agent-controller/:controllerId/...`). Controllers built by
 * `createRuntimeController` are already registered on an explicit Mastra (keyed by
 * config.id). Controllers from mastracode's `createMastraCode` use an internal
 * Mastra that doesn't list them, so we wrap them on a fresh Mastra under `label`.
 */
function resolveServingTarget(
  runtime: ServableRuntime,
  label: string,
): { mastra: Mastra; controllerId: string } {
  const existing = runtime.mastra ?? runtime.controller.getMastra();
  if (existing) {
    for (const [key, value] of Object.entries(existing.listAgentControllers())) {
      if (value === runtime.controller) return { mastra: existing, controllerId: key };
    }
  }
  const mastra = new Mastra({
    agentControllers: { [label]: runtime.controller },
    ...(runtime.storage ? { storage: runtime.storage as never } : {}),
  });
  return { mastra, controllerId: label };
}

export interface BuildAgentControllerAppOptions {
  /** A pre-constructed runtime: an AgentController + its session (plus optional Mastra/metadata). */
  runtime: ServableRuntime;
  /** Registration key used when the controller isn't already listed on a Mastra. */
  label: string;
}

/**
 * Build the Hono app that fronts a runtime's AgentController — the Pe-owned `/pe/*` extras
 * plus the native `@mastra/server` agent-controller routes (`/api/agent-controller/*`).
 *
 * Pure: it does NOT bind a port. Mount `app.fetch` under any server — the host mounts it into
 * its Effect `HttpRouter` at the absolute paths; the dev shim below binds it with
 * `@hono/node-server`. `MastraServer#init` is async, so the builder is async.
 */
export async function buildAgentControllerApp(
  options: BuildAgentControllerAppOptions,
): Promise<Hono> {
  const runtime = requireServableRuntime(options.runtime);
  const { mastra, controllerId } = resolveServingTarget(runtime, options.label);
  const info: PeWebInfo = {
    controllerId,
    resourceId: runtime.session!.identity.getResourceId(),
  };

  const app = new Hono();
  app.use("*", cors());
  // Handshake: the SPA fetches this to learn which controller/session to drive
  // over the native @mastra/server agent-controller routes (mounted under /api).
  app.get("/pe/info", (c) => c.json(info));
  // Pe-owned transparency: resolved system prompt, final tool list, skills, OM
  // config — captured on pea's agent (InputProcessor + model wrap), surfaced here
  // because native display-state doesn't carry them. Composition, not a core fork.
  app.get("/pe/inspect", (c) => c.json((runtime.metadata?.workbench as unknown) ?? {}));
  // Pe send route (multimodal): delegates to the in-process Session, which the native HTTP
  // `/messages` route can't because its body is `{ message: string }`. The reply streams over the
  // native session SSE, same as a native send — this only carries the input.
  app.post("/pe/messages", async (c) => {
    const parsed = peSendMessageSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: "Invalid message body." }, 400);
    void runtime.session!.sendMessage({ content: parsed.data.message, files: parsed.data.files });
    return c.json({ ok: true });
  });

  // Route-state dispatcher: the server-side seam of the collaborative-UI primitive.
  // Pea's three universal tools and the browser are thin clients of these endpoints;
  // the AgentController session owns the state, so writes here fan out over the same
  // native `state_changed` event both consumers already listen to.
  const routeStateSession: RouteStateSession = {
    getState: () => (runtime.session!.state.get() as Record<string, unknown>) ?? {},
    update: (updater) => runtime.session!.state.update(updater as never),
  };
  app.get("/pe/route-state", (c) => c.json(listRouteStates(routeStateSession)));
  app.get("/pe/route-state/:route", (c) => {
    const route = c.req.param("route");
    const view = describeRouteState(routeStateSession, route);
    return view ? c.json(view) : c.json({ error: `unknown route '${route}'` }, 404);
  });
  app.post("/pe/route-state/:route/apply", async (c) => {
    const parsed = routeStateApplyBodySchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) {
      return c.json({ ok: false, error: "invalid body", hint: "expected { actor, patches }" }, 400);
    }
    const result = await applyRouteStatePatches(
      routeStateSession,
      c.req.param("route"),
      parsed.data.actor,
      parsed.data.patches,
    );
    return c.json(result);
  });
  app.post("/pe/route-state/:route/command", async (c) => {
    const parsed = routeStateCommandBodySchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) {
      return c.json(
        { ok: false, error: "invalid body", hint: "expected { actor, command, input? }" },
        400,
      );
    }
    const result = await runRouteStateCommand(
      routeStateSession,
      c.req.param("route"),
      parsed.data.actor,
      parsed.data.command,
      parsed.data.input,
    );
    return c.json(result);
  });

  const server = new MastraServer({ app: app as never, mastra });
  await server.init();
  return app;
}

export interface RuntimeAgentControllerWebOptions<TRuntimeOptions = unknown> {
  label: string;
  title?: string;
  createRuntime: (options: TRuntimeOptions) => Promise<unknown>;
  runtimeOptions?: TRuntimeOptions;
  host?: string;
  port?: number;
  /** Static SPA build to serve alongside the API (production single-server). Omit in dev. */
  staticDir?: string;
  /** @deprecated Use `port`. Kept for launcher compatibility. */
  workbenchPort?: number;
  /** Accepted but unused — native routes are open on loopback. */
  workbenchToken?: string;
}

/**
 * Dev/standalone server shim: construct a runtime, build its Hono app via
 * {@link buildAgentControllerApp}, optionally serve a static SPA, bind a port, and hold the
 * process until SIGINT/SIGTERM. Pea no longer uses this (the host mounts
 * `buildAgentControllerApp` into its own Effect server); it remains as a standalone dev
 * server for controller runtimes that need the wrap branch in `resolveServingTarget`.
 */
export async function runRuntimeAgentControllerWeb<TRuntimeOptions = unknown>(
  options: RuntimeAgentControllerWebOptions<TRuntimeOptions>,
): Promise<void> {
  const runtime = requireServableRuntime(
    await options.createRuntime((options.runtimeOptions ?? {}) as TRuntimeOptions),
  );
  const app = await buildAgentControllerApp({ runtime, label: options.label });
  const host = options.host ?? "127.0.0.1";
  const port = options.port ?? options.workbenchPort ?? 43112;

  if (options.staticDir) {
    app.use("*", serveStatic({ root: options.staticDir }));
    app.get("*", serveStatic({ path: "index.html", root: options.staticDir }));
  }

  const node = serve({ fetch: app.fetch, hostname: host, port });
  console.log(`${options.label} agent-controller API http://${host}:${port}/api`);

  await waitForShutdown(async () => {
    await new Promise<void>((resolve) => node.close(() => resolve()));
    await runtime.close?.();
  });
}

async function waitForShutdown(close: () => Promise<void>): Promise<void> {
  let closing = false;
  await new Promise<void>((resolve) => {
    const shutdown = () => {
      if (closing) return;
      closing = true;
      void close().finally(resolve);
    };
    process.once("SIGINT", shutdown);
    process.once("SIGTERM", shutdown);
  });
}
