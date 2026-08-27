import { AgentController, type Session } from "@mastra/core/agent-controller";
import { Mastra } from "@mastra/core/mastra";
import { MastraServer } from "@mastra/hono";
import { Hono, type Context } from "hono";
import { streamSSE } from "hono/streaming";
import { z } from "zod";
import { addressSchema } from "@pe/agent-contracts";
import {
  RouteWorkspace,
  type RouteWorkspaceRegistration,
  type RouteWorkspaceScope,
} from "./route-workspace.ts";

/* ── Route-state dispatcher request bodies ─────────────────────────────────── */

const routeStatePatchSchema = z.object({
  path: z.array(z.union([z.string(), z.number()])),
  value: z.unknown().optional(),
});
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

/** The minimal shape we serve: an AgentController + its session, on a Mastra. */
export interface ServableRuntime {
  controller: AgentController;
  resourceId?: string;
  session?: Session;
  mastra?: Mastra;
  /** The controller's storage, shared with the wrap Mastra so thread routes resolve. */
  storage?: unknown;
  /** Pe-owned transparency payload (system prompt, tool list, skills, OM config). */
  metadata?: Record<string, unknown>;
  isSessionAdmitted?(session: Session): boolean;
  close?: () => Promise<void> | void;
}

function requireServableRuntime(value: unknown): ServableRuntime {
  const runtime = value as Partial<ServableRuntime> | undefined;
  if (!(runtime?.controller instanceof AgentController)) {
    throw new Error("Runtime agent-controller web requires an AgentController.");
  }
  if (!runtime.resourceId) throw new Error("Runtime agent-controller web requires resourceId.");
  return runtime as ServableRuntime;
}

/**
 * Resolve the Mastra to mount and the registration key the controller lives under
 * (route paths are `/api/agent-controller/:controllerId/...`). Controllers built by
 * `createRuntimeController` are already registered on an explicit Mastra (keyed by
 * config.id). Controllers from mastracode's `createMastraCode` use an internal
 * Mastra that doesn't list them, so we wrap them on a fresh Mastra under `label`.
 */
function resolveServingTarget(runtime: ServableRuntime, label: string): Mastra {
  const existing = runtime.mastra ?? runtime.controller.getMastra();
  if (existing) {
    for (const value of Object.values(existing.listAgentControllers())) {
      if (value === runtime.controller) return existing;
    }
  }
  return new Mastra({
    agentControllers: { [label]: runtime.controller },
    ...(runtime.storage ? { storage: runtime.storage as never } : {}),
  });
}

export interface BuildAgentControllerAppOptions {
  /** A pre-constructed runtime: an AgentController + its session (plus optional Mastra/metadata). */
  runtime: ServableRuntime;
  /** Registration key used when the controller isn't already listed on a Mastra. */
  label: string;
  /** Fixed route registrations supplied by the host composition root. */
  routeRegistrations?: readonly RouteWorkspaceRegistration[];
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
  const mastra = resolveServingTarget(runtime, options.label);
  const resourceId = runtime.resourceId!;

  const app = new Hono();
  // Pe-owned transparency: resolved system prompt, final tool list, skills, OM
  // config — captured on pea's agent (InputProcessor + model wrap), surfaced here
  // because native display-state doesn't carry them. Composition, not a core fork.
  app.get("/pe/inspect", (c) => c.json((runtime.metadata?.workbench as unknown) ?? {}));
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
          type: `route-workspace:${documentAddress}:${route}`,
        }),
      setState: ({ documentAddress, route, value }) =>
        threadState!.setState({
          threadId: resourceId,
          type: `route-workspace:${documentAddress}:${route}`,
          value,
        }),
    },
  });

  // Discovery is deliberately unscoped and shallow. Every document read/write must name
  // exactly one scope; omission never falls back to the active session thread.
  app.get("/pe/route-state", (c) => c.json(routeWorkspace.list()));
  app.get("/pe/route-state/:route", async (c) => {
    const scope = parseRouteWorkspaceScope(c);
    if (typeof scope === "string")
      return c.json({ error: "route scope is required", hint: scope }, 400);
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
    const scope = parseRouteWorkspaceScope(c);
    if (typeof scope === "string")
      return c.json({ error: "route scope is required", hint: scope }, 400);
    const route = c.req.param("route");
    try {
      if (!(await routeWorkspace.read(scope, route)))
        return c.json({ error: `unknown route '${route}'` }, 404);
    } catch (error) {
      return c.json({ error: errorMessage(error) }, 403);
    }
    return streamRouteWorkspace(c, routeWorkspace, scope, route);
  });
  const mountRouteStateWrites = (prefix: string, actor: "agent" | "human") => {
    app.post(`${prefix}/:route/apply`, async (c) => {
      const scope = parseRouteWorkspaceScope(c);
      if (typeof scope === "string")
        return c.json({ ok: false, error: "route scope is required", hint: scope }, 400);
      const parsed = routeStateApplyBodySchema.safeParse(await c.req.json().catch(() => null));
      if (!parsed.success) {
        return c.json(
          { ok: false, error: "invalid body", hint: "expected { patches, expectedRevision }" },
          400,
        );
      }
      try {
        return c.json(
          await routeWorkspace.apply(
            scope,
            c.req.param("route"),
            actor,
            parsed.data.patches,
            parsed.data.expectedRevision,
          ),
        );
      } catch (error) {
        return c.json({ ok: false, error: errorMessage(error) }, 403);
      }
    });
    app.post(`${prefix}/:route/command`, async (c) => {
      const scope = parseRouteWorkspaceScope(c);
      if (typeof scope === "string")
        return c.json({ ok: false, error: "route scope is required", hint: scope }, 400);
      const parsed = routeStateCommandBodySchema.safeParse(await c.req.json().catch(() => null));
      if (!parsed.success) {
        return c.json(
          {
            ok: false,
            error: "invalid body",
            hint: "expected { command, input?, expectedRevision, requestId? }",
          },
          400,
        );
      }
      try {
        return c.json(
          await routeWorkspace.command(
            scope,
            c.req.param("route"),
            actor,
            parsed.data.command,
            parsed.data.input,
            parsed.data.expectedRevision,
            parsed.data.requestId,
          ),
        );
      } catch (error) {
        return c.json({ ok: false, error: errorMessage(error) }, 403);
      }
    });
  };
  mountRouteStateWrites("/pe/route-state", "human");
  mountRouteStateWrites("/pe/agent/route-state", "agent");

  const server = new MastraServer({ app: app as never, mastra });
  await server.init();
  return app;
}

function parseRouteWorkspaceScope(c: Context): RouteWorkspaceScope | string {
  const parsed = addressSchema.safeParse(c.req.query("doc")?.trim());
  return parsed.success ? { documentAddress: parsed.data } : "doc required";
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
      if (event.route === route && sameRouteWorkspaceScope(event.scope, scope)) notify();
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

function sameRouteWorkspaceScope(left: RouteWorkspaceScope, right: RouteWorkspaceScope): boolean {
  return left.documentAddress === right.documentAddress;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
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
}
