import { execFile } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { createServer } from "node:net";
import { setTimeout as sleep } from "node:timers/promises";
import { promisify } from "node:util";
import { Context, Deferred, Effect, Layer } from "effect";
import { HttpRouter, HttpServer, HttpServerResponse as Response } from "effect/unstable/http";
import { hostProcessIdentity } from "@pe/host-contracts/contracts";
import {
  discoverService,
  readServiceFile,
  sweepDeadServiceFiles,
  type ServiceFile,
} from "@pe/host-contracts/pe-service";
import {
  authorizeShutdownFor,
  claimServiceHost,
  chooseServicePort,
  rememberServicePort,
  type ServiceHostDescriptor,
  type ServiceHostHandle,
} from "@pe/host-contracts/pe-service-host";
import { hostOwnership, productRoot, type HostOwnership } from "./host-ownership.ts";
import { runtimeOwnerRejection } from "@pe/host-contracts/service-identity";

// The dev script authorizes same-checkout dev takeover only; the SDK owns cooperative retirement.
const DEV_TAKEOVER_ARGUMENT = "--take-over-host";
const installedPort = 5180;

type PortOccupant = {
  readonly pid: number;
  readonly executable: string;
  readonly serviceName?: string;
};

/** A successful exclusive bind proves availability; the actual host bind and SDK claim still arbitrate races. */
export function installedPortAvailable(port: number): Promise<boolean> {
  return new Promise((resolve, reject) => {
    const server = createServer().unref();
    server.once("error", (error: NodeJS.ErrnoException) => {
      if (error.code === "EADDRINUSE" || error.code === "EACCES") resolve(false);
      else reject(error);
    });
    server.listen({ host: "127.0.0.1", port, exclusive: true }, () =>
      server.close((error) => (error ? reject(error) : resolve(true))),
    );
  });
}

/** Native netstat's numeric listener rows; unknown formats never establish an owner. */
export function tcpListenerPids(stdout: string, port: number): number[] {
  const endpoints = new Set([`127.0.0.1:${port}`, `0.0.0.0:${port}`, `[::]:${port}`]);
  const pids = new Set<number>();
  for (const line of stdout.split(/\r?\n/)) {
    const fields = line.trim().split(/\s+/);
    if (fields[0] !== "TCP") continue;
    if (fields.length !== 5) throw Error("Unrecognized native TCP owner census row.");
    if (fields[3] !== "LISTENING" || !endpoints.has(fields[1]!)) continue;
    const pid = Number(fields[4]);
    if (!/^[1-9]\d*$/.test(fields[4]!) || !Number.isSafeInteger(pid))
      throw Error("Native TCP owner census returned an invalid process id.");
    pids.add(pid);
  }
  return [...pids];
}

/** Read-only Windows census; SDK readers own record parsing. Never signal an occupant. */
async function readPortOccupants(appBase: string, port: number): Promise<PortOccupant[]> {
  // Get-NetTCPConnection requires CIM, which is unavailable even to SYSTEM in Windows Sandbox.
  // netstat reads the native TCP table; Get-Process/SDK discovery retain independent PID/path/start proof.
  const tcp = await promisify(execFile)("netstat", ["-ano", "-p", "tcp"], {
    windowsHide: true,
    timeout: 5_000,
  });
  const pids = tcpListenerPids(tcp.stdout, port);
  if (pids.length === 0) return [];
  const { stdout } = await promisify(execFile)(
    "powershell",
    [
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      `$ErrorActionPreference='Stop'; $owners=@(${pids.join(",")}); $rows=@(foreach ($ownerPid in $owners) { $p=Get-Process -Id $ownerPid; [pscustomobject]@{pid=$ownerPid;executable=$(if ($p.Path) {$p.Path} else {$p.ProcessName + ' (path unavailable)'})} }); ConvertTo-Json -InputObject $rows -Compress`,
    ],
    { windowsHide: true, timeout: 5_000 },
  );
  const occupants = JSON.parse(stdout) as PortOccupant[];
  const entries = await readdir(join(appBase, "state", "service")).catch(
    (error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return [];
      throw error;
    },
  );
  const records = await Promise.all(
    entries
      .filter((entry) => entry.endsWith(".json"))
      .map(async (entry) => {
        const name = entry.slice(0, -5);
        return { name, file: await readServiceFile(appBase, name) };
      }),
  );
  return occupants.map((occupant) => ({
    ...occupant,
    serviceName: records.find(({ file }) => file?.pid === occupant.pid && file.port === port)?.name,
  }));
}

const bindingDependencies = {
  discover: discoverService,
  choosePort: chooseServicePort,
  portAvailable: installedPortAvailable,
  occupants: readPortOccupants,
  healthy: async (file: ServiceFile) => {
    try {
      const response = await fetch(
        `http://127.0.0.1:${file.port}${file.health ?? hostProcessIdentity.healthPath}`,
        { signal: AbortSignal.timeout(1_000), redirect: "manual" },
      );
      await response.body?.cancel();
      return response.status >= 200 && response.status < 400;
    } catch {
      return false;
    }
  },
  retire: async (file: ServiceFile) => {
    const response = await fetch(
      `http://127.0.0.1:${file.port}${hostProcessIdentity.shutdownPath}`,
      {
        method: "POST",
        headers: { "x-pe-service-token": file.token },
        signal: AbortSignal.timeout(5_000),
      },
    );
    await response.body?.cancel();
    if (!response.ok) throw new Error(`shutdown returned HTTP ${response.status}`);
  },
  sleep,
  alive: (pid: number) => {
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  },
};

function describeOccupant(occupant: PortOccupant): string {
  return `pid ${occupant.pid}, executable ${occupant.executable}${occupant.serviceName ? `, service '${occupant.serviceName}'` : ""}`;
}

/** Installed reuse/refusal happens before bind. Dev retains SDK port choice and takeover. */
export async function prepareHostBinding(
  open: boolean,
  version: string,
  ownership: HostOwnership = hostOwnership,
  dependencies = bindingDependencies,
): Promise<number | ServiceFile> {
  const appBase = productRoot();
  const live =
    ownership.lane === "installed" || open
      ? await dependencies.discover(appBase, ownership.serviceName, { verifyOwner: true })
      : null;
  if (ownership.lane === "dev") {
    if (live) {
      const rejection = runtimeOwnerRejection(ownership, {
        ...live,
        serviceName: ownership.serviceName,
      });
      if (rejection) throw Error(`Dev host reuse refused: ${rejection}`);
    }
    if (open && live?.version === version) return live;
    return dependencies.choosePort(
      appBase,
      ownership.serviceName,
      Number(new URL(hostProcessIdentity.defaultHostBaseUrl).port),
    );
  }
  if (live) {
    const owners = await dependencies.occupants(appBase, live.port);
    const samePath = (a: string, b: string) =>
      a.replaceAll("\\", "/").toLowerCase() === b.replaceAll("\\", "/").toLowerCase();
    const verified =
      live.lane === "installed" &&
      live.executablePath &&
      samePath(live.executablePath, ownership.executablePath) &&
      owners.some(
        (owner) => owner.pid === live.pid && samePath(owner.executable, live.executablePath!),
      ) &&
      (await dependencies.healthy(live));
    if (!verified)
      throw new Error(
        `Installed host refused: service '${ownership.serviceName}' has a live ${live.lane} record (${describeOccupant({ pid: live.pid, executable: live.executablePath ?? "unknown", serviceName: ownership.serviceName })}); not a verified serving installed incumbent. ${owners.map(describeOccupant).join("; ")}`,
      );
    if (live.version === version) return live;
    console.log(`pe-host retiring ${live.version} incumbent pid ${live.pid} on port ${live.port}`);
    try {
      await dependencies.retire(live);
    } catch (cause) {
      throw new Error(
        `Installed host refused: stale incumbent pid ${live.pid}, version ${live.version} failed to retire.`,
        { cause },
      );
    }
    // Wait for the PROCESS to exit, not just the port: the SDK claim refuses while the retiring pid
    // is alive (installed policy evicts nothing), and a host disposing its tray releases the port
    // seconds before it exits. That race left 0.7.4's stub-relaunched host a silent claim loser.
    for (let attempt = 0; attempt <= 30; attempt++) {
      if (!dependencies.alive(live.pid)) break;
      if (attempt === 30)
        throw new Error(
          `Installed host refused: stale incumbent pid ${live.pid}, version ${live.version} is still running after shutdown.`,
        );
      await dependencies.sleep(1_000);
    }
  }
  if (await dependencies.portAvailable(installedPort)) return installedPort;
  let detail: string;
  try {
    const owners = await dependencies.occupants(appBase, installedPort);
    detail = owners.length
      ? owners.map(describeOccupant).join("; ")
      : "unknown listener or inaccessible port";
  } catch (cause) {
    detail = `owner census unavailable: ${String(cause)}`;
  }
  throw new Error(
    `Installed host cannot bind 127.0.0.1:${installedPort}: occupied or inaccessible; ${detail}. No takeover or alternate port.`,
  );
}

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
    policy: {
      evicts:
        hostOwnership.lane === "dev" && process.argv.includes(DEV_TAKEOVER_ARGUMENT) ? ["dev"] : [],
    },
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
    if (hostOwnership.lane === "dev") {
      const existing = yield* Effect.promise(() =>
        readServiceFile(appBase, hostOwnership.serviceName),
      );
      if (existing) {
        const rejection = runtimeOwnerRejection(hostOwnership, {
          ...existing,
          serviceName: hostOwnership.serviceName,
        });
        if (rejection)
          return yield* Effect.die(new Error(`Dev host service claim refused: ${rejection}`));
      }
    }
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

/** The native launcher owns PWA identity, registration and the browser's install flow. */
export async function openWindow(port: number): Promise<void> {
  const backend = `http://127.0.0.1:${port}/`;
  const response = await fetch(backend, {
    headers: { Accept: "text/html" },
    redirect: "manual",
    signal: AbortSignal.timeout(60_000),
  });
  const location = response.headers.get("location");
  if (!response.ok && !(response.status >= 300 && response.status < 400 && location))
    throw Error(`Window page is unavailable (HTTP ${response.status}).`);
  const destination = new URL(location ?? backend, backend);
  if (
    destination.protocol !== "http:" ||
    destination.hostname !== "127.0.0.1" ||
    destination.username ||
    destination.password
  )
    throw Error("Window page is not this local frontend.");
  await response.body?.cancel();
  const executable =
    hostOwnership.lane === "installed"
      ? join(dirname(hostOwnership.executablePath), "tray", "Pe.Host.Tray.exe")
      : join(
          hostOwnership.sourceRoot!,
          ".artifacts",
          "build",
          "Pe.Host.Tray",
          "Debug.R25",
          "Pe.Host.Tray.exe",
        );
  if (!existsSync(executable)) throw Error("Native PWA launcher is not built for this runtime.");
  await promisify(execFile)(executable, ["--launch-window", destination.href], {
    windowsHide: true,
    timeout: 10_000,
  });
}

/** Same installed-PWA/install flow as the tray and --open, authorized by the claim token. */
export const adminWindowRoute = HttpRouter.add("POST", "/admin/window", (request) =>
  Effect.gen(function* () {
    const handle = yield* Deferred.await((yield* HostLifecycle).handle);
    if (!authorizeShutdownFor(handle)(request.headers, null))
      return yield* Response.json({ error: "Forbidden" }, { status: 403 });
    const opened = yield* Effect.tryPromise(() => openWindow(handle.serviceFile.port)).pipe(
      Effect.map(() => true),
      Effect.catch(() => Effect.succeed(false)),
    );
    if (!opened)
      return yield* Response.json(
        { error: "Could not open the PWA or its install page." },
        { status: 502 },
      );
    return yield* Response.json({ opened: true });
  }),
);
