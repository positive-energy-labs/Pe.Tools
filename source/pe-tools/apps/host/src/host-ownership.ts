import { homedir } from "node:os";
import { join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { Effect } from "effect";
import { hostProcessIdentity, productIdentity } from "@pe/host-contracts/contracts";
import { readServiceFile } from "./pe-service.ts";

export type HostLane = "dev" | "installed";

export type HostOwnership = {
  readonly executablePath: string;
  readonly lane: HostLane;
  readonly processId: number;
  readonly sourceRoot: string | null;
};

// Mirrors the SDK-owned shutdown-token header. The vendored pe-service.ts keeps this string
// private (SHUTDOWN_TOKEN_HEADER, not exported) and must stay byte-identical, so the takeover
// sender re-declares it here rather than importing it. This is the takeover/probe flow D3 deletes
// wholesale once the SDK PeServiceHost primitive lands (SDK-LEDGER S-DEF-1/S-DEF-12).
const SERVICE_TOKEN_HEADER = "x-pe-service-token";
const DEV_SHUTDOWN_HEADER = "x-pe-host-dev-shutdown";
const DEV_TAKEOVER_ARGUMENT = "--take-over-host";
const HOST_BASE_URL =
  process.env[hostProcessIdentity.hostBaseUrlVariable] ?? hostProcessIdentity.defaultHostBaseUrl;

export const HOST_PORT = Number(new URL(HOST_BASE_URL).port || "5180");
export const hostOwnership = resolveHostOwnership();

export const prepareHostOwnership = Effect.fnUntraced(function* () {
  if (hostOwnership.lane === "dev") yield* takeoverCurrentHost();
});

export function shouldTakeOverCurrentHost(
  currentLane: HostLane,
  explicitDevTakeover: boolean,
): boolean {
  return currentLane === "installed" || explicitDevTakeover;
}

/**
 * Product root under `%LOCALAPPDATA%\<vendor>\<product>` — the A10 service-file `appBase`
 * (`state/service/host.json` lives beneath it) and the install-receipt root. Resolved lazily so
 * tests can redirect it via `LOCALAPPDATA`.
 */
export function productRoot(): string {
  return join(
    process.env.LOCALAPPDATA ?? join(homedir(), "AppData", "Local"),
    productIdentity.vendorName,
    productIdentity.productName,
  );
}

function resolveHostOwnership(): HostOwnership {
  return {
    executablePath: process.execPath,
    lane: resolveHostLane(),
    processId: process.pid,
    sourceRoot: resolveSourceRoot(),
  };
}

function resolveHostLane(): HostLane {
  // PE_LANE is the SDK's authoritative lane signal — InstalledService sets it on every installed
  // spawn, so the installed lane is asserted rather than inferred. PE_TOOLS_HOST_LANE is the
  // product launcher's dev-path signal; the path heuristic is a last resort for bare hosts.
  for (const candidate of [process.env.PE_LANE, process.env.PE_TOOLS_HOST_LANE]) {
    const lane = candidate?.trim().toLowerCase();
    if (lane === "dev" || lane === "installed") return lane;
  }
  return isSourceHost() ? "dev" : "installed";
}

function isSourceHost(): boolean {
  const marker = `${normalize("apps/host/src").toLowerCase()}\\`;
  const modulePath = currentModulePath();
  if (modulePath && normalize(modulePath).toLowerCase().includes(marker)) return true;
  return process.argv.some((arg) => normalize(arg).toLowerCase().includes(marker));
}

function resolveSourceRoot(): string | null {
  if (hostOwnershipEnvironmentSource()) return hostOwnershipEnvironmentSource();
  const modulePath = currentModulePath();
  if (!modulePath) return null;
  const marker = `${normalize("apps/host/src").toLowerCase()}\\`;
  const normalized = normalize(modulePath);
  const index = normalized.toLowerCase().indexOf(marker);
  return index >= 0 ? normalized.slice(0, index - 1) : null;
}

function hostOwnershipEnvironmentSource(): string | null {
  const value = process.env.PE_TOOLS_HOST_SOURCE_DIR?.trim();
  return value || null;
}

function currentModulePath(): string | null {
  try {
    return fileURLToPath(import.meta.url);
  } catch {
    return null;
  }
}

const takeoverCurrentHost = Effect.fnUntraced(function* () {
  const current = yield* probeCurrentHost();
  const explicitDevTakeover = process.argv.includes(DEV_TAKEOVER_ARGUMENT);
  if (!current || !shouldTakeOverCurrentHost(current.lane, explicitDevTakeover)) return;
  const service = yield* Effect.promise(() =>
    readServiceFile(productRoot(), hostProcessIdentity.serviceName),
  );
  if (!service || service.pid !== current.processId || service.port !== HOST_PORT || !service.token)
    return yield* Effect.fail(
      new Error("Current host does not match its service-file identity; refusing takeover."),
    );
  yield* requestShutdown(service.token, current.lane === "dev");
  yield* waitForPortRelease();
});

const probeCurrentHost = Effect.fnUntraced(function* () {
  return yield* Effect.tryPromise(async () => {
    const response = await fetch(new URL(hostProcessIdentity.healthPath, HOST_BASE_URL), {
      signal: AbortSignal.timeout(500),
    });
    if (!response.ok) return null;
    const body = (await response.json()) as Partial<{ lane: HostLane; processId: number }>;
    return (body.lane === "dev" || body.lane === "installed") && typeof body.processId === "number"
      ? { lane: body.lane, processId: body.processId }
      : null;
  }).pipe(Effect.catch(() => Effect.succeed(null)));
});

const requestShutdown = Effect.fnUntraced(function* (token: string, allowDevShutdown: boolean) {
  yield* Effect.tryPromise(async () => {
    const response = await fetch(new URL(hostProcessIdentity.shutdownPath, HOST_BASE_URL), {
      method: "POST",
      headers: {
        [SERVICE_TOKEN_HEADER]: token,
        ...(allowDevShutdown ? { [DEV_SHUTDOWN_HEADER]: "true" } : {}),
      },
      signal: AbortSignal.timeout(1_000),
    });
    if (!response.ok) throw new Error(`host shutdown rejected with HTTP ${response.status}`);
  });
});

const waitForPortRelease = Effect.fnUntraced(function* () {
  yield* Effect.tryPromise(async () => {
    const deadline = Date.now() + 5_000;
    while (Date.now() < deadline) {
      if (!(await isHostListening())) return;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error(`host port ${HOST_PORT} did not release after takeover shutdown`);
  });
});

async function isHostListening(): Promise<boolean> {
  try {
    const response = await fetch(new URL(hostProcessIdentity.healthPath, HOST_BASE_URL), {
      signal: AbortSignal.timeout(250),
    });
    return response.ok;
  } catch {
    return false;
  }
}
