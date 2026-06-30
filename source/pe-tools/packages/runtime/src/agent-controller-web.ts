import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { AgentController, type Session } from "@mastra/core/agent-controller";
import { Mastra } from "@mastra/core/mastra";
import { MastraServer } from "@mastra/hono";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { z } from "zod";

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

/** The minimal shape we serve: an AgentController + its session, on a Mastra. */
interface ServableRuntime {
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

export async function runRuntimeAgentControllerWeb<TRuntimeOptions = unknown>(
  options: RuntimeAgentControllerWebOptions<TRuntimeOptions>,
): Promise<void> {
  const runtime = requireServableRuntime(
    await options.createRuntime((options.runtimeOptions ?? {}) as TRuntimeOptions),
  );
  const { mastra, controllerId } = resolveServingTarget(runtime, options.label);
  const host = options.host ?? "127.0.0.1";
  const port = options.port ?? options.workbenchPort ?? 43112;
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

  const server = new MastraServer({ app: app as never, mastra });
  await server.init();

  if (options.staticDir) {
    app.use("*", serveStatic({ root: options.staticDir }));
    app.get("*", serveStatic({ path: "index.html", root: options.staticDir }));
  }

  const node = serve({ fetch: app.fetch, hostname: host, port });
  const baseUrl = `http://${host}:${port}`;
  console.log(`${options.label} agent-controller API ${baseUrl}/api`);
  console.log(`${options.label} controller=${info.controllerId} resource=${info.resourceId}`);

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
