import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { Context, Deferred, Effect, Layer } from "effect";
import { HttpRouter, HttpServer, HttpServerResponse as Response } from "effect/unstable/http";
import { hostProcessIdentity } from "@pe/host-contracts/contracts";
import { sweepDeadServiceFiles } from "@pe/host-contracts/pe-service";
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
const DEV_TAKEOVER_ARGUMENT = "--take-over-host";

/**
 * Lifecycle handles shared between the launch root and the request handlers (Pillar 3):
 * - `latch`: raced against `Layer.launch`; tripping it closes the launch scope so every finalizer
 *   runs (graceful server close, harness children, service-file release), replacing the old
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
    readonly startTray?: (handle: ServiceHostHandle) => Promise<() => Promise<void>>;
  }
>()("pe/HostLifecycle") {}

/**
 * The host version reported in the service file. On the installed lane it is read from the payload
 * manifest the MSI copies to the install root — `product.payloads.json` is the single authority for
 * the installed layout and its version, so nothing is stamped into this package at pack time. A
 * missing or unparsable manifest is fatal: reporting a placeholder version to `session list` would
 * be a lie about which build is serving. The source lane is "dev" and reads nothing.
 */
export function resolveHostVersion(): string {
  if (hostOwnership.lane !== "installed") return "dev";
  const manifestPath = join(productRoot(), "product.payloads.json");
  let version: unknown;
  try {
    version = (JSON.parse(readFileSync(manifestPath, "utf8")) as { version?: unknown }).version;
  } catch (cause) {
    throw new Error(`Installed host cannot read its payload manifest at ${manifestPath}.`, {
      cause,
    });
  }
  if (typeof version !== "string" || version.length === 0)
    throw new Error(`Payload manifest ${manifestPath} has no usable "version".`);
  return version;
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
    // `pe-revit session list` narrates companion legs and never starts them, so without this it
    // can only infer liveness from a TCP accept — and a reused port makes a stranger look like us.
    // Declaring the health path is what gets this leg the `health` rung instead of the `tcp` one.
    health: hostProcessIdentity.healthPath,
    policy: hostReplacementPolicy(hostOwnership.lane, process.argv.includes(DEV_TAKEOVER_ARGUMENT)),
  };
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
    const { handle: handleDeferred, startTray } = yield* HostLifecycle;
    const address = server.address;
    const port = address._tag === "TcpAddress" ? address.port : 0;
    const appBase = productRoot();
    // Both variables describe a host that is RUNNING — a spawned child reads them to call back
    // into this process. They become lies the moment the claim releases, so they are scoped to it
    // and restored on the way out. (Unrestored, an in-process host inside a test run leaves its
    // dead port in `PE_TOOLS_HOST_BASE_URL` for every later file.)
    yield* Effect.acquireRelease(
      Effect.sync(() => {
        const previous = {
          [hostProcessIdentity.hostBaseUrlVariable]:
            process.env[hostProcessIdentity.hostBaseUrlVariable],
          [hostProcessIdentity.serviceNameVariable]:
            process.env[hostProcessIdentity.serviceNameVariable],
        };
        process.env[hostProcessIdentity.hostBaseUrlVariable] = `http://127.0.0.1:${port}`;
        process.env[hostProcessIdentity.serviceNameVariable] = hostOwnership.serviceName;
        return previous;
      }),
      (previous) =>
        Effect.sync(() => {
          for (const [name, value] of Object.entries(previous))
            if (value === undefined) delete process.env[name];
            else process.env[name] = value;
        }),
    );
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
    if (hostOwnership.lane === "installed" && startTray)
      yield* Effect.acquireRelease(
        Effect.promise(() => startTray(handle)),
        (dispose) => Effect.promise(dispose),
      );
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

/** Edge app mode is the desktop window (host ledger 2026-10-08): Edge ships with Windows, `--app`
 * drops the tabs and address bar, and the product's own profile keeps the window apart from the
 * user's browsing. The default browser is the fallback when Edge is absent. */
export function openWindow(port: number): void {
  const url = `http://127.0.0.1:${port}/`;
  const edge = [process.env["ProgramFiles(x86)"], process.env.ProgramFiles]
    .filter((root): root is string => root !== undefined)
    .map((root) => join(root, "Microsoft", "Edge", "Application", "msedge.exe"))
    .find((candidate) => existsSync(candidate));
  console.log(`pe-host opening ${url}${edge ? " in an Edge app window" : ""}`);
  // detached: on Windows a non-detached child dies with this process, and the reuse path exits at once.
  const [command, args] = edge
    ? [
        edge,
        [`--app=${url}`, `--user-data-dir=${join(productRoot(), "edge-app")}`, "--no-first-run"],
      ]
    : ["cmd.exe", ["/c", "start", "", url]];
  // windowsHide only for cmd: it passes SW_HIDE, which a GUI exe may apply to its first window.
  spawn(command, args, { detached: true, windowsHide: !edge, stdio: "ignore" }).unref();
}

/** The tray's Open window: the same Edge app window as `--open`, authorized by the claim token. */
export const adminWindowRoute = HttpRouter.add("POST", "/admin/window", (request) =>
  Effect.gen(function* () {
    const handle = yield* Deferred.await((yield* HostLifecycle).handle);
    if (!authorizeShutdownFor(handle)(request.headers, null))
      return yield* Response.json({ error: "Forbidden" }, { status: 403 });
    openWindow(handle.serviceFile.port);
    return yield* Response.json({ opened: true });
  }),
);
