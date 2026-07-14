import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Context, Deferred, Effect, Layer } from "effect";
import { HttpRouter, HttpServer, HttpServerResponse as Response } from "effect/unstable/http";
import { hostOwnership, isValidTakeoverToken, productRoot } from "./host-ownership.ts";
import { createServiceFile, deleteServiceFile, writeServiceFile } from "./pe-service.ts";

const SERVICE_NAME = "host";
const SERVICE_TOKEN_HEADER = "x-pe-service-token";
const TAKEOVER_TOKEN_HEADER = "x-pe-host-takeover-token";

/**
 * Lifecycle handles shared between the launch root and the request handlers (Pillar 3):
 * - `latch`: raced against `Layer.launch`; tripping it closes the launch scope so every finalizer
 *   runs (graceful server close -> Mastra release -> service-file delete -> identity delete),
 *   replacing the old `process.exit(0)` that skipped them.
 * - `serviceToken`: minted once at boot, written into the service file, and required to authorize
 *   the shutdown endpoint (A10 convention).
 */
export class HostLifecycle extends Context.Service<
  HostLifecycle,
  {
    readonly latch: Deferred.Deferred<void>;
    readonly serviceToken: string;
  }
>()("pe/HostLifecycle") {}

/**
 * The host version reported in the service file: the install receipt's release version in the
 * installed lane, "dev" otherwise — mirroring what `/host/install` surfaces.
 */
export function resolveHostVersion(): string {
  if (hostOwnership.lane === "installed") {
    try {
      const receipt = JSON.parse(
        readFileSync(join(productRoot(), "install.receipt.json"), "utf8"),
      ) as { releaseVersion?: unknown };
      if (typeof receipt.releaseVersion === "string" && receipt.releaseVersion) {
        return receipt.releaseVersion;
      }
    } catch {
      /* no receipt (or unreadable) -> fall through to the dev sentinel */
    }
  }
  return "dev";
}

/**
 * Writes `state/service/host.json` with the ACTUAL bound port on start and deletes it on graceful
 * shutdown (A10 discovery: the port a service actually bound is authoritative). Depends on
 * `HttpServer` so it runs after bind, and on `HostLifecycle` for the boot-minted token.
 */
export const ServiceFileLive = Layer.effectDiscard(
  Effect.gen(function* () {
    const server = yield* HttpServer.HttpServer;
    const { serviceToken } = yield* HostLifecycle;
    const address = server.address;
    const port = address._tag === "TcpAddress" ? address.port : 0;
    const file = createServiceFile(port, resolveHostVersion(), hostOwnership.lane, serviceToken);
    const appBase = productRoot();
    yield* Effect.acquireRelease(
      Effect.promise(() => writeServiceFile(appBase, SERVICE_NAME, file)),
      () => Effect.promise(() => deleteServiceFile(appBase, SERVICE_NAME, file.instanceId)),
    );
  }),
);

/**
 * Graceful self-shutdown: authorize on EITHER the existing takeover token (`x-pe-host-takeover-token`)
 * OR the A10 service token (`x-pe-service-token` header or a JSON body `{ token }`). Respond 200
 * FIRST, then trip the latch on a detached fiber so the response flushes before the launch scope
 * tears the server down.
 */
export const adminShutdownRoute = HttpRouter.add("POST", "/admin/shutdown", (request) =>
  Effect.gen(function* () {
    const { latch, serviceToken } = yield* HostLifecycle;

    // An installed Revit client may race to reassert its installed host while source dev is
    // taking over 5180. Never let that automatic service request evict an intentional dev host.
    // Dev is stopped by its owning terminal; the explicit header is only for controlled tooling.
    if (hostOwnership.lane === "dev" && request.headers["x-pe-host-dev-shutdown"] !== "true")
      return yield* Response.json({ error: "Dev host is terminal-owned." }, { status: 409 });

    const takeover = request.headers[TAKEOVER_TOKEN_HEADER];
    const serviceHeader = request.headers[SERVICE_TOKEN_HEADER];
    let authorized =
      isValidTakeoverToken(takeover) ||
      (typeof serviceHeader === "string" && serviceHeader === serviceToken);

    if (!authorized) {
      // Fall back to the JSON body `{ token }` the SDK client also sends.
      const body = yield* Effect.orElseSucceed(request.json, () => null);
      const bodyToken = (body as { token?: unknown } | null)?.token;
      authorized = typeof bodyToken === "string" && bodyToken === serviceToken;
    }

    if (!authorized) return yield* Response.json({ error: "Forbidden" }, { status: 403 });

    yield* Effect.forkDetach(Deferred.succeed(latch, undefined));
    return yield* Response.json({ shuttingDown: true, lane: hostOwnership.lane });
  }),
);
