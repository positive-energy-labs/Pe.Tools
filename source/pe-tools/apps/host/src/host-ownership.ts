import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { Effect } from "effect";
import {
  hostProcessIdentity,
  productIdentity,
  productPathNames,
} from "@pe/host-contracts/contracts";

export type HostLane = "dev" | "installed";

export type HostOwnership = {
  readonly executablePath: string;
  readonly identityPath: string;
  readonly lane: HostLane;
  readonly processId: number;
  readonly sourceRoot: string | null;
  readonly takeoverToken: string;
};

type HostIdentityFile = {
  readonly executablePath: string;
  readonly lane: HostLane;
  readonly pid: number;
  readonly port: number;
  readonly sourceRoot: string | null;
  readonly startedAtUtc: string;
  readonly takeoverToken: string;
};

const TAKEOVER_HEADER = "x-pe-host-takeover-token";
const HOST_BASE_URL =
  process.env[hostProcessIdentity.hostBaseUrlVariable] ?? hostProcessIdentity.defaultHostBaseUrl;

export const HOST_PORT = Number(new URL(HOST_BASE_URL).port || "5180");
export const hostOwnership = resolveHostOwnership();

export const prepareHostOwnership = Effect.fnUntraced(function* () {
  if (hostOwnership.lane === "dev") yield* takeoverInstalledHost(hostOwnership);
  return yield* Effect.acquireRelease(writeIdentity(hostOwnership), cleanupIdentity);
});

export function isValidTakeoverToken(value: string | undefined): boolean {
  return value === hostOwnership.takeoverToken;
}

export function scheduleShutdown(): void {
  setTimeout(() => process.exit(0), 25);
}

function resolveHostOwnership(): HostOwnership {
  return {
    executablePath: process.execPath,
    identityPath: hostIdentityPath(),
    lane: resolveHostLane(),
    processId: process.pid,
    sourceRoot: resolveSourceRoot(),
    takeoverToken: randomUUID(),
  };
}

function resolveHostLane(): HostLane {
  const configured = process.env.PE_TOOLS_HOST_LANE?.trim().toLowerCase();
  if (configured === "dev" || configured === "installed") return configured;
  return isSourceHost() ? "dev" : "installed";
}

function isSourceHost(): boolean {
  const modulePath = currentModulePath();
  if (
    modulePath &&
    normalize(modulePath)
      .toLowerCase()
      .includes(`${normalize("apps/host/src").toLowerCase()}\\`)
  )
    return true;
  return process.argv.some((arg) =>
    normalize(arg).toLowerCase().includes(normalize("apps/host/src").toLowerCase()),
  );
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

function hostIdentityPath(): string {
  return join(productRoot(), productPathNames.stateDirectoryName, "host", "identity.json");
}

function productRoot(): string {
  return join(
    process.env.LOCALAPPDATA ?? join(homedir(), "AppData", "Local"),
    productIdentity.vendorName,
    productIdentity.productName,
  );
}

const writeIdentity = Effect.fnUntraced(function* (ownership: HostOwnership) {
  yield* Effect.tryPromise(async () => {
    await mkdir(dirname(ownership.identityPath), { recursive: true });
    const identity = {
      executablePath: ownership.executablePath,
      lane: ownership.lane,
      pid: ownership.processId,
      port: HOST_PORT,
      sourceRoot: ownership.sourceRoot,
      startedAtUtc: new Date().toISOString(),
      takeoverToken: ownership.takeoverToken,
    } satisfies HostIdentityFile;
    await writeFile(ownership.identityPath, `${JSON.stringify(identity, null, 2)}\n`, "utf8");
  });
  return ownership;
});

const cleanupIdentity = (ownership: HostOwnership) =>
  Effect.tryPromise(async () => {
    if (!existsSync(ownership.identityPath)) return;
    const identity = JSON.parse(
      await readFile(ownership.identityPath, "utf8"),
    ) as Partial<HostIdentityFile>;
    if (identity.pid === ownership.processId) await rm(ownership.identityPath, { force: true });
  }).pipe(Effect.catch(() => Effect.void));

const takeoverInstalledHost = Effect.fnUntraced(function* (ownership: HostOwnership) {
  const current = yield* probeCurrentHost();
  if (!current || current.lane !== "installed") return;
  const token = yield* readTakeoverToken(ownership.identityPath);
  if (!token)
    return yield* Effect.fail(
      new Error(`Installed host is running but ${ownership.identityPath} has no takeover token.`),
    );
  yield* requestShutdown(token);
  yield* waitForPortRelease();
});

const probeCurrentHost = Effect.fnUntraced(function* () {
  return yield* Effect.tryPromise(async () => {
    const response = await fetch(new URL("/host/status", HOST_BASE_URL), {
      signal: AbortSignal.timeout(500),
    });
    if (!response.ok) return null;
    const body = (await response.json()) as Partial<{ lane: HostLane }>;
    return body.lane === "dev" || body.lane === "installed" ? { lane: body.lane } : null;
  }).pipe(Effect.catch(() => Effect.succeed(null)));
});

const readTakeoverToken = Effect.fnUntraced(function* (identityPath: string) {
  return yield* Effect.tryPromise(async () => {
    const identity = JSON.parse(await readFile(identityPath, "utf8")) as Partial<HostIdentityFile>;
    return typeof identity.takeoverToken === "string" ? identity.takeoverToken : null;
  }).pipe(Effect.catch(() => Effect.succeed(null)));
});

const requestShutdown = Effect.fnUntraced(function* (token: string) {
  yield* Effect.tryPromise(async () => {
    const response = await fetch(new URL("/admin/shutdown", HOST_BASE_URL), {
      method: "POST",
      headers: { [TAKEOVER_HEADER]: token },
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
    const response = await fetch(new URL("/host/status", HOST_BASE_URL), {
      signal: AbortSignal.timeout(250),
    });
    return response.ok;
  } catch {
    return false;
  }
}
