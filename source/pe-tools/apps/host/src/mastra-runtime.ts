import { mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { Cause, Context, Effect, Layer } from "effect";
import { HttpEffect, HttpRouter, HttpServer } from "effect/unstable/http";
import { productPathNames } from "@pe/host-contracts/contracts";
import { createRouteRegistrations } from "@pe/mcps";
import { buildAgentControllerApp } from "@pe/runtime";
import { createPeaRuntime } from "@pe/runtime/pea";
import { productRoot } from "./host-ownership.ts";
import { setAgentRuntimeStatus } from "./local-ops.ts";

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
 * D4 observability: spawned hosts run detached with stdio ignored, so `Effect.logError` alone
 * makes an init failure invisible. Persist it beside the host's other state
 * (`state/host/mastra-init.err.log`) and report it to `/host/status` via `setAgentRuntimeStatus`.
 */
function mastraInitErrorLogPath(): string {
  return join(productRoot(), productPathNames.stateDirectoryName, "host", "mastra-init.err.log");
}

/** Structural ThreadLockError match anywhere in the `cause` chain. */
function isThreadLockShaped(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; current instanceof Error && depth < 5; depth++) {
    if (current.name === "ThreadLockError") return true;
    current = current.cause;
  }
  return false;
}

/** Message + stack, following the `cause` chain (tryPromise wraps the original throw). */
function formatInitError(error: unknown): string {
  const parts: string[] = [];
  let current: unknown = error;
  for (let depth = 0; current != null && depth < 5; depth++) {
    parts.push(
      current instanceof Error ? (current.stack ?? current.message) : formatCause(current),
    );
    current = current instanceof Error ? current.cause : null;
  }
  return parts.join("\ncaused by: ");
}

function formatCause(value: unknown): string {
  if (typeof value === "string") return value;
  if (
    typeof value === "number" ||
    typeof value === "boolean" ||
    typeof value === "bigint" ||
    typeof value === "symbol"
  )
    return String(value);
  try {
    return JSON.stringify(value) ?? Object.prototype.toString.call(value);
  } catch {
    return Object.prototype.toString.call(value);
  }
}

const persistMastraInitError = (detail: string) =>
  Effect.promise(async () => {
    try {
      const logPath = mastraInitErrorLogPath();
      await mkdir(dirname(logPath), { recursive: true });
      await writeFile(
        logPath,
        `${new Date().toISOString()} Mastra runtime failed to start\n${detail}\n`,
        "utf8",
      );
    } catch {
      /* best-effort: observability must not change the degrade-to-503 behavior */
    }
  });

/**
 * The agent surface once the tenant is unavailable: every agent route answers 503, never crashes.
 * `async` on purpose — the `fromWebHandler` seam awaits (`.then`) the handler's result, so this must
 * return a Promise, not a bare `Response`.
 */
const agentUnavailableResponse = async () =>
  Response.json({ error: "Agent runtime unavailable on this host." }, { status: 503 });

/**
 * Record a degraded agent runtime (D4 observability), then never fail: log it, persist it beside the
 * host's other state (`state/host/mastra-init.err.log`), and surface it on `/host/status`. Shared by
 * the in-layer catch (a clean init failure that `Effect.catch` recovers) and the composition-boundary
 * net {@link withMastraDegrade} (a defect that escapes the failure channel).
 */
const recordMastraDegrade = (error: unknown) =>
  Effect.gen(function* () {
    yield* Effect.logError("Mastra runtime failed to start; agent surface degraded to 503", error);
    const detail = formatInitError(error);
    setAgentRuntimeStatus({ available: false, error: detail });
    yield* persistMastraInitError(detail);
  });

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
        // Host takeover races the pea thread lock: the dying incumbent can hold it for a
        // few seconds after conceding the port. Retry instead of degrading to 503.
        const runtime = await (async () => {
          for (let attempt = 1; ; attempt += 1) {
            try {
              return await createPeaRuntime({ hostBaseUrl, protocol: "web" });
            } catch (error) {
              if (attempt >= 10 || !isThreadLockShaped(error)) throw error;
              await new Promise((resolve) => setTimeout(resolve, 2000));
            }
          }
        })();
        const app = await buildAgentControllerApp({
          runtime,
          label: "pea",
          routeRegistrations: createRouteRegistrations({ hostBaseUrl }),
        });
        setAgentRuntimeStatus({ available: true, error: null });
        // A stale error log from a previous degraded boot would misreport this healthy one.
        await rm(mastraInitErrorLogPath(), { force: true }).catch(() => undefined);
        // hono's `fetch` may return `Response | Promise<Response>`; normalize to a Promise so the
        // seam matches `HttpEffect.fromWebHandler`'s `(req) => Promise<Response>` contract.
        return {
          runtime: runtime as { close?: () => Promise<void> } | null,
          fetch: (request: Request) => Promise.resolve(app.fetch(request)),
        };
      }).pipe(
        // A broken agent runtime (bad auth profile, storage failure) must NOT take the Revit
        // bridge down with it — Revit respawns the host, so a boot defect here becomes a crash
        // loop. Degrade the agent surface to 503 and keep serving — but observably (D4): persist
        // the failure and surface it on /host/status. `Effect.catch` recovers the FAILURE channel
        // only (a clean init rejection); a defect that escapes it is contained one level up by the
        // composition-boundary net {@link withMastraDegrade}, so the merged layer never collapses.
        Effect.catch((error) =>
          recordMastraDegrade(error).pipe(
            Effect.as({
              runtime: null as { close?: () => Promise<void> } | null,
              fetch: agentUnavailableResponse,
            }),
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
 * Composition-boundary containment for the agent tenant (the invariant the host lives or dies by):
 * the service claim (`ServiceFileLive`) is a SIBLING of this layer inside `makeHttpLive`'s single
 * `Layer.mergeAll`, and one uncaught failing member of a merge takes down `Layer.launch` — so the
 * host would never bind or claim, presenting to the SDK supervisor as "did not become healthy".
 *
 * `MastraRuntimeLive`'s in-layer `Effect.catch` already degrades a clean init FAILURE, but per
 * Effect's contract it does not recover a DEFECT (e.g. a `TypeError` thrown deep in the pea/mastra
 * init machinery under the SEA). `Layer.catchCause` here recovers ANY cause — failure, defect, or a
 * shutdown interrupt — by switching to a degraded 503 tenant, so no agent-runtime boot outcome can
 * ever collapse the merged layer. Interruption-only causes are teardown, not a degrade, so they are
 * not reported.
 */
export const withMastraDegrade = <R>(
  mastraLayer: Layer.Layer<MastraRuntime, unknown, R>,
): Layer.Layer<MastraRuntime, never, R> =>
  mastraLayer.pipe(
    Layer.catchCause((cause) =>
      Layer.effect(
        MastraRuntime,
        (Cause.hasInterruptsOnly(cause)
          ? Effect.void
          : recordMastraDegrade(Cause.squash(cause))
        ).pipe(Effect.as({ fetch: agentUnavailableResponse })),
      ),
    ),
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
