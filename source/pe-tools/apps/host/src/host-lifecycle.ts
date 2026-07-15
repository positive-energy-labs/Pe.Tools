import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Context, Deferred, Effect, Layer } from "effect";
import { HttpRouter, HttpServer, HttpServerResponse as Response } from "effect/unstable/http";
import { hostProcessIdentity } from "@pe/host-contracts/contracts";
import { hostOwnership, productRoot } from "./host-ownership.ts";
import {
  authorizeShutdownFor,
  claimServiceHost,
  hostReplacementPolicy,
  type ServiceHostDescriptor,
  type ServiceHostHandle,
} from "./pe-service-host.ts";

// The dev script (`pnpm dev`) passes this to authorize a dev-over-dev takeover; it becomes
// `hostReplacementPolicy` DATA (SDK-owned), not local probe logic (IPC-SEAM-SPEC D3).
const DEV_TAKEOVER_ARGUMENT = "--take-over-host";

/**
 * Lifecycle handles shared between the launch root and the request handlers (Pillar 3):
 * - `latch`: raced against `Layer.launch`; tripping it closes the launch scope so every finalizer
 *   runs (graceful server close -> Mastra release -> service-file release), replacing the old
 *   `process.exit(0)` that skipped them.
 * - `handle`: resolved once the SDK claim (`claimServiceHost`) installs this host's identity on bind.
 *   The shutdown route awaits it to authorize with the claim's per-launch token; the claim owns the
 *   service-file lifecycle (write on claim, delete on release) — no locally minted token or writer.
 */
export class HostLifecycle extends Context.Service<
  HostLifecycle,
  {
    readonly latch: Deferred.Deferred<void>;
    readonly handle: Deferred.Deferred<ServiceHostHandle>;
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
 * Build the SDK claim descriptor for this host after it has bound `port`. `executablePath` is this
 * process's own image (the D2 identity signal the installed-lane C# supervisor matches on:
 * `process.execPath` of the SEA host equals the resolved installed entry). `sourceRoot` is recorded
 * on the dev lane only, so the C# dev-lane reuse rule can match a healthy dev host by its checkout
 * rather than by its (node) executable. Replacement policy is DATA (SDK-owned `hostReplacementPolicy`):
 * a dev host evicts an installed host automatically, another dev host only with `--take-over-host`.
 */
function buildHostDescriptor(port: number): ServiceHostDescriptor {
  return {
    name: hostProcessIdentity.serviceName,
    lane: hostOwnership.lane,
    version: resolveHostVersion(),
    port,
    executablePath: hostOwnership.executablePath,
    sourceRoot: hostOwnership.lane === "dev" ? (hostOwnership.sourceRoot ?? undefined) : undefined,
    shutdown: hostProcessIdentity.shutdownPath,
    policy: hostReplacementPolicy(hostOwnership.lane, process.argv.includes(DEV_TAKEOVER_ARGUMENT)),
  };
}

/**
 * Claims sole ownership of `state/service/host.json` on start via the SDK `claimServiceHost`
 * primitive (D3): it writes the identity file with the ACTUAL bound port, evicts a policy-permitted
 * incumbent end-to-end (SDK-owned — no local probe/takeover), and its handle deletes the file on
 * graceful shutdown. Depends on `HttpServer` so it runs after bind (the bound port is authoritative,
 * A10 discovery is file-based), and on `HostLifecycle` to publish the claim handle for the shutdown
 * route. A refused claim is fatal — this host cannot own the service.
 */
export const ServiceFileLive = Layer.effectDiscard(
  Effect.gen(function* () {
    const server = yield* HttpServer.HttpServer;
    const { handle: handleDeferred } = yield* HostLifecycle;
    const address = server.address;
    const port = address._tag === "TcpAddress" ? address.port : 0;
    const appBase = productRoot();
    console.log(
      `pe-host service claim requested name=${hostProcessIdentity.serviceName} leaseHandoff=${Boolean(process.env.PE_SERVICE_LEASE_PATH)}`,
    );
    const handle = yield* Effect.acquireRelease(
      Effect.promise(() => claimServiceHost(appBase, buildHostDescriptor(port))).pipe(
        Effect.flatMap((result) =>
          result.claimed
            ? Effect.succeed(result.handle)
            : Effect.die(new Error(`host service claim refused: ${result.reason}`)),
        ),
      ),
      (handle) => Effect.promise(() => handle.release()),
    );
    console.log(`pe-host service claim acquired pid=${handle.serviceFile.pid} port=${port}`);
    yield* Deferred.succeed(handleDeferred, handle);
  }),
);

/**
 * Graceful self-shutdown authorized by the SDK claim's per-launch token (`x-pe-service-token` header
 * or a JSON body `{ token }`), validated through `authorizeShutdownFor`. Respond 200 FIRST, then trip
 * the latch on a detached fiber so the response flushes before the launch scope tears the server down.
 * No dev-lane header guard: the installed-lane C# supervisor no longer evicts a healthy dev host (D4),
 * so the token alone is the authority.
 */
export const adminShutdownRoute = HttpRouter.add(
  "POST",
  hostProcessIdentity.shutdownPath,
  (request) =>
    Effect.gen(function* () {
      const { latch, handle: handleDeferred } = yield* HostLifecycle;
      const handle = yield* Deferred.await(handleDeferred);

      // Token auth via the SDK-owned validator: X-Pe-Service-Token header or JSON body { token }.
      const body = yield* Effect.orElseSucceed(request.json, () => null);
      if (!authorizeShutdownFor(handle)(request.headers, body))
        return yield* Response.json({ error: "Forbidden" }, { status: 403 });

      yield* Effect.forkDetach(Deferred.succeed(latch, undefined));
      return yield* Response.json({ shuttingDown: true, lane: hostOwnership.lane });
    }),
);
