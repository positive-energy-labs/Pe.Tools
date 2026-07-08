import { Context, Effect, Layer } from "effect";
import { HttpEffect, HttpRouter, HttpServer } from "effect/unstable/http";
import { buildAgentControllerApp } from "@pe/runtime";
import { createPeaRuntime } from "@pe/runtime/pea";

/**
 * The Mastra agent runtime as an Effect tenant (Pillar 1). Its HTTP surface is a Hono app
 * (`buildAgentControllerApp`) mounted into the host's own router (Pillar 2). We expose only the
 * `fetch` seam; the underlying `PeaRuntimeHandle` is captured by the scoped finalizer so its
 * release ordering (session abort -> thread lock release -> controller destroy) runs when the
 * host's launch scope closes, instead of leaking on `process.exit`.
 */
export class MastraRuntime extends Context.Service<
  MastraRuntime,
  {
    readonly fetch: (request: Request) => Promise<Response>;
  }
>()("pe/MastraRuntime") {}

/**
 * Builds the pea runtime AFTER the server has bound (this layer depends on `HttpServer`), so the
 * bound loopback address is the runtime's `hostBaseUrl` — pea's product tools call our own port,
 * no cross-process hop. Depending on `HttpServer` also sequences this layer after bind; a brief
 * routes-404 window during startup is acceptable. `LocalSandbox` captures `process.env` at acquire
 * time, so constructing here (layer build, after any lane-env mutation is settled) is correct.
 */
export const MastraRuntimeLive = Layer.effect(
  MastraRuntime,
  Effect.gen(function* () {
    const server = yield* HttpServer.HttpServer;
    const address = server.address;
    const port = address._tag === "TcpAddress" ? address.port : 0;
    const hostBaseUrl = `http://127.0.0.1:${port}`;

    const handle = yield* Effect.acquireRelease(
      Effect.tryPromise(async () => {
        const runtime = await createPeaRuntime({ hostBaseUrl });
        const app = await buildAgentControllerApp({ runtime, label: "pea" });
        // hono's `fetch` may return `Response | Promise<Response>`; normalize to a Promise so the
        // seam matches `HttpEffect.fromWebHandler`'s `(req) => Promise<Response>` contract.
        return {
          runtime: runtime as { close?: () => Promise<void> } | null,
          fetch: (request: Request) => Promise.resolve(app.fetch(request)),
        };
      }).pipe(
        // A broken agent runtime (bad auth profile, storage failure) must NOT take the Revit
        // bridge down with it — Revit respawns the host, so a boot defect here becomes a crash
        // loop. Degrade the agent surface to 503 and keep serving.
        Effect.catch((error) =>
          Effect.as(
            Effect.logError("Mastra runtime failed to start; agent surface degraded to 503", error),
            {
              runtime: null,
              fetch: async () =>
                Response.json(
                  { error: "Agent runtime unavailable on this host." },
                  { status: 503 },
                ),
            },
          ),
        ),
      ),
      // Release must never throw: swallow a rejecting close so scope teardown continues.
      (built) =>
        Effect.promise(async () => {
          try {
            await built.runtime?.close?.();
          } catch {
            /* best-effort: a failed close must not abort the rest of shutdown */
          }
        }),
    );

    return { fetch: handle.fetch };
  }),
);

/**
 * Mount the tenant's Hono app at its ABSOLUTE existing paths (no prefix strip) so the browser
 * contract (`/api` MastraClient prefix, `/pe/info` handshake) is untouched. `fromWebHandler`
 * bridges the current `HttpServerRequest` to a web `Request` and streams the `Response` back
 * (SSE passes through unbuffered). The same handler effect serves both path families.
 */
export const MastraMountLive = HttpRouter.use((router) =>
  Effect.gen(function* () {
    const { fetch } = yield* MastraRuntime;
    const handler = HttpEffect.fromWebHandler((request) => fetch(request));
    yield* router.add("*", "/api/agent-controller/*", handler);
    yield* router.add("*", "/pe/*", handler);
  }),
);
