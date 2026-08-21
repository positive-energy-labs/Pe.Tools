import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Context, Deferred, Effect, Layer } from "effect";
import { HttpRouter, HttpServer, HttpServerResponse as Response } from "effect/unstable/http";
import { hostProcessIdentity } from "@pe/host-contracts/contracts";
import {
  isRecordedOwnerAlive,
  readServiceFile,
  sweepDeadServiceFiles,
  writeServiceFile,
} from "@pe/host-contracts/pe-service";
import {
  authorizeShutdownFor,
  claimServiceHost,
  hostReplacementPolicy,
  rememberServicePort,
  type ServiceHostDescriptor,
  type ServiceHostHandle,
} from "@pe/host-contracts/pe-service-host";
import { hostOwnership, productRoot } from "./host-ownership.ts";

// The dev script (`pnpm dev`) passes this to authorize a dev-over-dev takeover; it becomes
// `hostReplacementPolicy` DATA (SDK-owned), not local probe logic (IPC-SEAM-SPEC D3).
export const DEV_TAKEOVER_ARGUMENT = "--take-over-host";

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
 * rather than by its (node) executable. Installed and source hosts have different names; a source
 * host replaces only its own worktree's prior incarnation, and only with `--take-over-host`.
 */
function buildHostDescriptor(port: number): ServiceHostDescriptor {
  return {
    name: hostOwnership.serviceName,
    lane: hostOwnership.lane,
    version: resolveHostVersion(),
    port,
    executablePath: hostOwnership.executablePath,
    sourceRoot: hostOwnership.lane === "dev" ? (hostOwnership.sourceRoot ?? undefined) : undefined,
    shutdown: hostProcessIdentity.shutdownPath,
    // Service-file schema 3: the relative path a READER may probe to decide this host is UP.
    // `pe-revit session status` narrates companion legs and never starts them, so without this it
    // can only infer liveness from a TCP accept — and a reused port makes a stranger look like us.
    // Declaring the health path is what gets this leg the `health` rung instead of the `tcp` one.
    health: hostProcessIdentity.healthPath,
    policy: hostReplacementPolicy(hostOwnership.lane, process.argv.includes(DEV_TAKEOVER_ARGUMENT)),
  };
}

/**
 * Schema-3 `sessionId`: record WHICH pe-revit session this host serves, once a Revit payload
 * registers on the bridge and tells us. It cannot be written at claim time — the claim happens on
 * bind, long before any Revit process connects — so this is an in-place amendment of our OWN file.
 *
 * Why it matters: without it, `session status` can only match this host to a session by LANE, and
 * it says so in as many words (`legBecause: "lane match and NOT proof that this host serves this
 * session"`). With it, the leg is an association the SDK can actually stand behind.
 *
 * Compare-and-swap on `instanceId`: if the file no longer names this launch, a successor claimed
 * it and writing would clobber a live identity. Best-effort throughout — a leg is narration, and
 * failing to improve it must never take the host down.
 */
export async function announceServedSession(
  appBase: string,
  handle: ServiceHostHandle,
  sessionId: string,
): Promise<void> {
  try {
    const current = await readServiceFile(appBase, hostOwnership.serviceName);
    if (!current || current.instanceId !== handle.serviceFile.instanceId) return;
    if (current.sessionId === sessionId) return;
    await writeServiceFile(appBase, hostOwnership.serviceName, { ...current, sessionId });
    console.log(`pe-host service file now names pe-revit session ${sessionId}`);
  } catch (error) {
    console.warn(`pe-host could not record the served session id: ${String(error)}`);
  }
}

/**
 * Cooperative token shutdown of a live service-file owner (the same wire shape the SDK's takeOver
 * uses), waiting for verified exit. Best-effort: a refusal returns and leaves downstream layers
 * (SDK claim, Mastra thread-lock retry) to report the contention honestly.
 *
 * A dev host runs this BEFORE binding (see host-program.ts) against exactly ONE incumbent: its own
 * same-name predecessor, gated on `--take-over-host` (the D3 dev-over-dev policy). Pre-bind
 * eviction lets `chooseServicePort` reuse the remembered port instead of drifting to an ephemeral
 * one on every takeover. The installed host is never a target — dev and installed hosts are
 * siblings (ruled 2026-08-20) and a Mastra thread contention degrades to 503, which is cheap;
 * dropping a live installed session's bridge is not.
 */
export async function evictLiveHost(appBase: string, name: string, why: string): Promise<void> {
  const incumbent = await readServiceFile(appBase, name);
  if (!incumbent || !(await isRecordedOwnerAlive(incumbent))) return;
  // A just-claimed live incumbent is a concurrent spawn, not a wedged predecessor: session
  // supervisors respawn the host on every bridge drop, and each takeover drops the bridge, so
  // evicting fresh claims livelocks the service (observed: 396 orphaned watchers, ~12s claim
  // churn, no host ever answering). Let the fresh incumbent win; this claim will be refused and
  // this spawn exits. Intentional dev-over-dev takeover of an older host still evicts. Defense
  // in depth: supervisors now spawn `@pe/host#attach` (no takeover flag), so only a human
  // `pnpm dev` reaches this eviction at all.
  const incumbentAgeMs = Date.now() - Date.parse(incumbent.processStartUtc);
  if (Number.isFinite(incumbentAgeMs) && incumbentAgeMs < 60_000) {
    console.log(
      `pe-host not evicting ${name} pid=${incumbent.pid} (claimed ${Math.round(incumbentAgeMs / 1000)}s ago; concurrent spawn)`,
    );
    return;
  }
  console.log(`pe-host evicting ${name} pid=${incumbent.pid} port=${incumbent.port} (${why})`);
  try {
    await fetch(`http://127.0.0.1:${incumbent.port}${hostProcessIdentity.shutdownPath}`, {
      method: "POST",
      headers: { "x-pe-service-token": incumbent.token, "content-type": "application/json" },
      body: JSON.stringify({ token: incumbent.token }),
      signal: AbortSignal.timeout(5_000),
    });
  } catch {
    return; // ponytail: unreachable/refusing incumbent — the SDK claim / Mastra retry reports it
  }
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline && (await isRecordedOwnerAlive(incumbent)))
    await new Promise((resolve) => setTimeout(resolve, 500));
}

/**
 * Claims sole ownership of this runtime's service file on start via the SDK `claimServiceHost`
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
    process.env[hostProcessIdentity.hostBaseUrlVariable] = `http://127.0.0.1:${port}`;
    process.env[hostProcessIdentity.serviceNameVariable] = hostOwnership.serviceName;
    console.log(
      `pe-host service claim requested name=${hostOwnership.serviceName} leaseHandoff=${Boolean(process.env.PE_SERVICE_LEASE_PATH)}`,
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
    yield* Effect.result(
      Effect.promise(() => rememberServicePort(appBase, hostOwnership.serviceName, port)),
    );
    // Hygiene: other worktrees' crashed hosts leave corpses; sweep dead host-source-* files (never
    // our own live claim, never the installed "host", never unreadable files — those are doctor's).
    yield* Effect.result(
      Effect.promise(() =>
        sweepDeadServiceFiles(appBase, {
          prefix: `${hostProcessIdentity.serviceName}-source-`,
          exclude: [hostOwnership.serviceName],
        }),
      ),
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
