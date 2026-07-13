/* eslint-disable no-control-regex -- Windows rejects ASCII control characters in service names. */
// pe-service.ts — the SDK-owned TypeScript client for the Pe service primitive (SDK-LEDGER A10).
//
// Service-file schema version: 2
// OWNED BY Pe.Revit.Sdk — DO NOT FORK. Copy this file verbatim into a consumer; the SDK ships it
// inside the Pe.Revit.Sdk nupkg under clients/ts/ so there is exactly ONE implementation per language
// (this mirrors Pe.Revit.Loader's C# InstalledProduct.EnsureRunning / ServiceFile byte-for-byte in
// behaviour). Dependency-free — Node stdlib only (fs/promises, path, child_process, crypto) plus the
// global fetch/AbortSignal (Node 18+).
//
// The runtime service file the SERVICE writes when it binds and deletes on graceful shutdown:
//   <appBase>/state/service/<name>.json =
//     { schemaVersion, instanceId, pid, processStartUtc, port, version, lane, token }
//   <appBase>/state/service/<name>.log  = the spawned service's captured stdout+stderr (truncated at each spawn)
// Discovery is file-based: the port the service actually bound is authoritative; a manifest's
// preferredPort is only a hint and is never hardcoded by a client. The shutdown endpoint is authorized
// by the file's per-launch token, sent BOTH as the header `X-Pe-Service-Token` and in the JSON body
// `{ "token": … }` (the proven host-ownership.ts wire shape, generalized).
//
// LOOPBACK MANDATE: a service under this contract MUST bind 127.0.0.1 only. The supervisor probes
// health and authenticates shutdown on loopback; binding a wider interface exposes the
// token-authenticated shutdown endpoint to the LAN and trips a Windows Firewall prompt per versioned
// exe path. Loopback-only, always.

import { spawn } from "node:child_process";
import { closeSync, existsSync, mkdirSync, openSync } from "node:fs";
import { mkdir, open, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";

export const SERVICE_FILE_SCHEMA_VERSION = 2;
const SHUTDOWN_TOKEN_HEADER = "x-pe-service-token";

export type ServiceTier = "managed" | "plain";

/** The runtime service file: { pid, port, version, lane, token }. `port` is the port actually bound. */
export interface ServiceFile {
  readonly schemaVersion: 2;
  readonly instanceId: string;
  readonly pid: number;
  readonly processStartUtc: string;
  readonly port: number;
  readonly version: string;
  readonly lane: string;
  readonly token: string;
}

export interface EnsureRunningOptions {
  /** The resolved launchable entry (an absolute path to the service exe). Spawned detached. */
  readonly entryPath: string;
  /** GET path returning 2xx/3xx when up, e.g. "/host/status". Required — without it we cannot verify. */
  readonly health: string;
  /** POST path for a token-authenticated graceful stop, e.g. "/admin/shutdown". Managed tier only. */
  readonly shutdown?: string;
  /** managed = our own exe (default, token shutdown); plain = third-party/sidecar (pid-kill). */
  readonly tier?: ServiceTier;
  /** Expected version; compared to the file's version. Omit to skip the version check (unversioned). */
  readonly expectedVersion?: string;
  /** Expected lane ("installed" | "dev"); compared to the file's lane. */
  readonly lane: string;
  /** Startup wait budget in ms (default 15000). One pass — the CALLER retries on its own backoff. */
  readonly timeoutMs?: number;
  /** Extra args for the spawned entry (default none). */
  readonly spawnArgs?: readonly string[];
  /** Extra env for the spawned entry. `PE_LANE` is always forced from `lane` after this merge. */
  readonly spawnEnv?: Readonly<Record<string, string>>;
}

export type EnsureRunningResult =
  | { readonly state: "running"; readonly file: ServiceFile }
  | { readonly state: "started"; readonly file: ServiceFile }
  | { readonly state: "failed"; readonly reason: string };

const HEALTH_TIMEOUT_MS = 500;
const SHUTDOWN_TIMEOUT_MS = 1_000;
const PORT_RELEASE_TIMEOUT_MS = 5_000;
const POLL_INTERVAL_MS = 250;
const DEFAULT_STARTUP_TIMEOUT_MS = 15_000;

interface ServiceLease {
  readonly path: string;
  readonly token: string;
}

async function acquireServiceLease(
  appBase: string,
  name: string,
  timeoutMs: number,
): Promise<ServiceLease | null> {
  const path = join(appBase, "state", "service", `${name}.lock`);
  await mkdir(dirname(path), { recursive: true });
  const deadline = Date.now() + timeoutMs;
  do {
    const token = randomUUID();
    try {
      const handle = await open(path, "wx");
      try {
        await handle.writeFile(JSON.stringify({ pid: process.pid, token }), "utf8");
      } finally {
        await handle.close();
      }
      return { path, token };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") return null;
      if (await leaseOwnerIsGone(path)) {
        await rm(path, { force: true }).catch(() => {});
        continue;
      }
      await delay(100);
    }
  } while (Date.now() < deadline);
  return null;
}

async function releaseServiceLease(lease: ServiceLease): Promise<void> {
  try {
    const owner = JSON.parse(await readFile(lease.path, "utf8")) as { token?: unknown };
    if (owner.token === lease.token) await rm(lease.path, { force: true });
  } catch {}
}

async function leaseOwnerIsGone(path: string): Promise<boolean> {
  try {
    const owner = JSON.parse(await readFile(path, "utf8")) as { pid?: unknown };
    if (typeof owner.pid === "number") return !(await pidIsAlive(owner.pid));
  } catch {}
  try {
    return Date.now() - (await stat(path)).mtimeMs > 2_000;
  } catch {
    return false;
  }
}

export function serviceFilePath(appBase: string, name: string): string {
  if (!isSafeServiceName(name)) throw new Error("Service name must be one safe file-name segment.");
  return join(appBase, "state", "service", `${name}.json`);
}

/** Read the service file (null when absent/unparseable/missing pid|port — never throws). */
export async function readServiceFile(appBase: string, name: string): Promise<ServiceFile | null> {
  const path = serviceFilePath(appBase, name);
  try {
    if (!existsSync(path)) return null;
    const raw = JSON.parse(await readFile(path, "utf8")) as Partial<ServiceFile>;
    if (
      raw.schemaVersion !== SERVICE_FILE_SCHEMA_VERSION ||
      typeof raw.instanceId !== "string" ||
      !raw.instanceId ||
      typeof raw.processStartUtc !== "string" ||
      !raw.processStartUtc ||
      typeof raw.pid !== "number" ||
      typeof raw.port !== "number"
    )
      return null;
    return {
      schemaVersion: SERVICE_FILE_SCHEMA_VERSION,
      instanceId: raw.instanceId,
      pid: raw.pid,
      processStartUtc: raw.processStartUtc,
      port: raw.port,
      version: typeof raw.version === "string" ? raw.version : "",
      lane: typeof raw.lane === "string" ? raw.lane : "",
      token: typeof raw.token === "string" ? raw.token : "",
    };
  } catch {
    return null;
  }
}

/** Write the service file (services call this on bind; tests plant fixtures). Creates state/service/. */
export async function writeServiceFile(
  appBase: string,
  name: string,
  file: ServiceFile,
): Promise<void> {
  const path = serviceFilePath(appBase, name);
  await mkdir(dirname(path), { recursive: true });
  const temp = `${path}.tmp-${randomUUID()}`;
  await writeFile(temp, `${JSON.stringify(file, null, 2)}\n`, "utf8");
  try {
    await rename(temp, path);
  } finally {
    await rm(temp, { force: true }).catch(() => {});
  }
}

/** Delete only the named launch's service file. Best-effort; a successor's identity wins. */
export async function deleteServiceFile(
  appBase: string,
  name: string,
  instanceId: string,
): Promise<boolean> {
  const current = await readServiceFile(appBase, name);
  if (!current || current.instanceId !== instanceId) return false;
  try {
    await rm(serviceFilePath(appBase, name));
    return true;
  } catch {
    return false;
  }
}

/** Create a schema-v2 identity for the calling service after it has bound its loopback port. */
export function createServiceFile(
  port: number,
  version: string,
  lane: string,
  token: string,
  instanceId: string = randomUUID(),
): ServiceFile {
  return {
    schemaVersion: SERVICE_FILE_SCHEMA_VERSION,
    instanceId,
    pid: process.pid,
    processStartUtc: new Date(Date.now() - process.uptime() * 1000).toISOString(),
    port,
    version,
    lane,
    token,
  };
}

/**
 * The A10 service primitive — one pass, no supervisor loop (the CALLER retries on its own backoff).
 * Mirrors Pe.Revit.Loader.InstalledProduct.EnsureRunning exactly:
 *   1. read state/service/<name>.json;
 *   2. present + healthy + version matches + lane matches ⇒ "running" (untouched);
 *   3. present + healthy but stale/wrong-lane ⇒ managed: POST shutdown with the token, wait for the
 *      port to release; plain / no response ⇒ kill by pid (only if the pid's image lives under appBase);
 *   4. present + unhealthy ⇒ guarded kill by pid; then delete the file;
 *   5. spawn the entry detached, wait up to timeoutMs for a healthy, matching service file ⇒ "started",
 *      else "failed".
 */
export async function ensureRunning(
  appBase: string,
  name: string,
  opts: EnsureRunningOptions,
): Promise<EnsureRunningResult> {
  if (!isSafeServiceName(name))
    return { state: "failed", reason: `payload '${name}' is not a safe service name` };
  if (
    !isLoopbackPath(opts.health) ||
    (opts.shutdown !== undefined && !isLoopbackPath(opts.shutdown))
  )
    return {
      state: "failed",
      reason: "service health/shutdown must be loopback absolute paths beginning with one '/'",
    };
  const timeoutMs = opts.timeoutMs ?? DEFAULT_STARTUP_TIMEOUT_MS;
  const lease = await acquireServiceLease(appBase, name, timeoutMs);
  if (!lease) return { state: "failed", reason: `service '${name}' is busy in another supervisor` };
  try {
    const existing = await readServiceFile(appBase, name);
    if (existing) {
      const stopped = (await probeHealth(existing.port, opts.health))
        ? matches(existing, opts.expectedVersion, opts.lane)
          ? null
          : await shutDown(appBase, existing, opts)
        : await killByPid(appBase, existing);
      if (stopped === null) return { state: "running", file: existing };
      if (!stopped)
        return {
          state: "failed",
          reason: `service '${name}' could not be safely stopped; identity was preserved`,
        };
      const current = await readServiceFile(appBase, name);
      if (current && current.instanceId !== existing.instanceId)
        return {
          state: "failed",
          reason: `service '${name}' changed identity while stopping; retry`,
        };
      if (current && !(await deleteServiceFile(appBase, name, existing.instanceId)))
        return { state: "failed", reason: `service '${name}' state could not be cleared; retry` };
    }
    return await spawnAndWait(appBase, name, opts);
  } finally {
    await releaseServiceLease(lease);
  }
}

function matches(file: ServiceFile, expectedVersion: string | undefined, lane: string): boolean {
  const versionOk = expectedVersion === undefined || file.version === expectedVersion;
  return versionOk && file.lane.toLowerCase() === lane.toLowerCase();
}

async function shutDown(
  appBase: string,
  file: ServiceFile,
  opts: EnsureRunningOptions,
): Promise<boolean> {
  if (
    (opts.tier ?? "managed") === "managed" &&
    opts.shutdown &&
    file.token &&
    (await requestShutdown(file.port, opts.shutdown, file.token)) &&
    (await waitForPortRelease(file.port, opts.health))
  ) {
    if (await waitForProcessExit(file.pid, 2_000)) return true;
  }
  return killByPid(appBase, file); // plain, or graceful stop unavailable/refused/timed out
}

async function spawnAndWait(
  appBase: string,
  name: string,
  opts: EnsureRunningOptions,
): Promise<EnsureRunningResult> {
  // Capture the detached service's stdout+stderr to state/service/<name>.log (truncated at each
  // spawn) so a service that dies before writing its file leaves a diagnosable trail.
  const logPath = join(appBase, "state", "service", `${name}.log`);
  let logFd: number;
  try {
    mkdirSync(dirname(logPath), { recursive: true });
    logFd = openSync(logPath, "w");
  } catch (error) {
    return {
      state: "failed",
      reason: `failed to open service log '${logPath}': ${describe(error)}`,
    };
  }
  let child: ReturnType<typeof spawn> | undefined;
  const childStartUtc = new Date().toISOString();
  try {
    child = spawn(opts.entryPath, [...(opts.spawnArgs ?? [])], {
      cwd: dirname(opts.entryPath),
      detached: true,
      stdio: ["ignore", logFd, logFd],
      env: { ...process.env, ...opts.spawnEnv, PE_LANE: opts.lane },
    });
    await new Promise<void>((resolve, reject) => {
      const onSpawn = () => {
        child!.off("error", onError);
        resolve();
      };
      const onError = (error: Error) => {
        child!.off("spawn", onSpawn);
        reject(error);
      };
      child!.once("spawn", onSpawn);
      child!.once("error", onError);
    });
    child.unref(); // detached: we never hold the child — the OS/service owns its lifetime
  } catch (error) {
    return { state: "failed", reason: `failed to start '${opts.entryPath}': ${describe(error)}` };
  } finally {
    closeSync(logFd); // the child dup'd both fds at spawn; the parent must not keep the log open
  }

  const timeoutMs = opts.timeoutMs ?? DEFAULT_STARTUP_TIMEOUT_MS;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await delay(POLL_INTERVAL_MS);
    const file = await readServiceFile(appBase, name);
    if (!file) continue;
    if (!(await probeHealth(file.port, opts.health))) continue;
    if (matches(file, opts.expectedVersion, opts.lane)) return { state: "started", file };
  }
  const cleaned = child?.pid ? await killByPid(appBase, child.pid, childStartUtc) : false;
  const timedOutFile = await readServiceFile(appBase, name);
  if (cleaned && timedOutFile && !(await pidIsAlive(timedOutFile.pid)))
    await deleteServiceFile(appBase, name, timedOutFile.instanceId);
  return {
    state: "failed",
    reason:
      `'${name}' did not become healthy within ${(timeoutMs / 1000).toFixed(1)}s; ` +
      (cleaned ? "spawned process tree was stopped" : "spawned process tree could not be stopped"),
  };
}

async function probeHealth(port: number, healthPath: string): Promise<boolean> {
  if (!healthPath) return false;
  try {
    const response = await fetch(loopbackUrl(port, healthPath), {
      signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS),
    });
    return response.status < 400;
  } catch {
    return false;
  }
}

async function requestShutdown(
  port: number,
  shutdownPath: string,
  token: string,
): Promise<boolean> {
  try {
    const response = await fetch(loopbackUrl(port, shutdownPath), {
      method: "POST",
      headers: { [SHUTDOWN_TOKEN_HEADER]: token, "content-type": "application/json" },
      body: JSON.stringify({ token }),
      signal: AbortSignal.timeout(SHUTDOWN_TIMEOUT_MS),
    });
    return response.status < 400;
  } catch {
    return false;
  }
}

function isSafeServiceName(name: string): boolean {
  if (
    !name ||
    name === "." ||
    name === ".." ||
    /[<>:"/\\|?*\x00-\x1f]/.test(name) ||
    /[ .]$/.test(name)
  )
    return false;
  return !/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name);
}

function isLoopbackPath(path: string): boolean {
  if (!path.startsWith("/") || path.startsWith("//") || path.includes("\\") || path.includes("#"))
    return false;
  try {
    const url = new URL(path, "http://127.0.0.1:1");
    return url.protocol === "http:" && url.hostname === "127.0.0.1" && url.port === "1";
  } catch {
    return false;
  }
}

function loopbackUrl(port: number, path: string): URL {
  const url = new URL(path, `http://127.0.0.1:${port}`);
  if (url.protocol !== "http:" || url.hostname !== "127.0.0.1" || Number(url.port) !== port)
    throw new Error("Service endpoint escaped loopback.");
  return url;
}

async function waitForPortRelease(port: number, healthPath: string): Promise<boolean> {
  const deadline = Date.now() + PORT_RELEASE_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (!(await probeHealth(port, healthPath))) return true;
    await delay(100);
  }
  return false;
}

/**
 * Kill the recorded pid, but ONLY after confirming its process image lives under appBase — the OS
 * reuses pids freely, so an unverified kill could take out an innocent process. Best-effort; if the
 * image cannot be verified, the process is left alone. Returns true when the process is gone.
 */
async function killByPid(appBase: string, file: ServiceFile): Promise<boolean>;
async function killByPid(appBase: string, pid: number, processStartUtc: string): Promise<boolean>;
async function killByPid(
  appBase: string,
  fileOrPid: ServiceFile | number,
  spawnedStartUtc?: string,
): Promise<boolean> {
  const pid = typeof fileOrPid === "number" ? fileOrPid : fileOrPid.pid;
  const expectedStart =
    typeof fileOrPid === "number" ? spawnedStartUtc! : fileOrPid.processStartUtc;
  if (!(await pidIsAlive(pid))) return true; // already gone
  const identity = await pidIdentity(pid);
  if (!identity || !withinRoot(identity.path, appBase)) return false;
  if (Math.abs(Date.parse(identity.startUtc) - Date.parse(expectedStart)) > 2_000) return false;
  try {
    const { execFile } = await import("node:child_process");
    await new Promise<void>((resolve, reject) => {
      execFile("taskkill", ["/PID", String(pid), "/T", "/F"], { timeout: 5_000 }, (error) =>
        error ? reject(error) : resolve(),
      );
    });
  } catch {
    if (await pidIsAlive(pid)) return false;
  }
  return waitForProcessExit(pid, 5_000);
}

async function waitForProcessExit(pid: number, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!(await pidIsAlive(pid))) return true;
    await delay(100);
  }
  return !(await pidIsAlive(pid));
}

async function pidIsAlive(pid: number): Promise<boolean> {
  try {
    process.kill(pid, 0); // signal 0 = existence probe, does not actually signal
    return true;
  } catch {
    return false;
  }
}

/** Resolve the image and start time together so a reused pid never inherits stale ownership. */
async function pidIdentity(pid: number): Promise<{ path: string; startUtc: string } | null> {
  if (process.platform !== "win32") return null; // the SDK targets Windows; other platforms: cannot verify
  try {
    const { execFile } = await import("node:child_process");
    return await new Promise<{ path: string; startUtc: string } | null>((resolve) => {
      execFile(
        "powershell",
        [
          "-NoProfile",
          "-NonInteractive",
          "-Command",
          `$p=Get-Process -Id ${pid}; [pscustomobject]@{path=$p.Path;startUtc=$p.StartTime.ToUniversalTime().ToString('o')} | ConvertTo-Json -Compress`,
        ],
        { timeout: 3_000 },
        (error, stdout) => {
          if (error) return resolve(null);
          try {
            const value = JSON.parse(stdout) as { path?: unknown; startUtc?: unknown };
            resolve(
              typeof value.path === "string" && typeof value.startUtc === "string"
                ? { path: value.path, startUtc: value.startUtc }
                : null,
            );
          } catch {
            resolve(null);
          }
        },
      );
    });
  } catch {
    return null;
  }
}

function withinRoot(imagePath: string, appBase: string): boolean {
  const normalize = (p: string) => p.replace(/\//g, "\\").replace(/\\+$/, "").toLowerCase();
  return normalize(imagePath).startsWith(`${normalize(appBase)}\\`);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

// --- Serve-side helpers ------------------------------------------------------------------------
// The small honest pieces a managed service needs to satisfy this contract (D10 defers the full
// PeServiceHost helper). The service mints a token at bind, writes it into the service file's
// `token`, binds 127.0.0.1 only (see LOOPBACK MANDATE above), and gates its shutdown route with
// isAuthorizedShutdown.

/** Mint a per-launch shutdown token — write it into the service file's `token` field at bind. */
export function createServiceToken(): string {
  return randomUUID();
}

/**
 * True when an inbound shutdown request carries the service's token — in the `X-Pe-Service-Token`
 * header OR a JSON body `{ token }`, the exact wire shape ensureRunning sends. An empty/absent token
 * never authorizes.
 */
export function isAuthorizedShutdown(
  headers: Record<string, string | string[] | undefined>,
  body: unknown,
  token: string,
): boolean {
  if (!token) return false;
  const header = headers[SHUTDOWN_TOKEN_HEADER];
  const headerValue = Array.isArray(header) ? header[0] : header;
  if (headerValue === token) return true;
  return typeof body === "object" && body !== null && (body as { token?: unknown }).token === token;
}
