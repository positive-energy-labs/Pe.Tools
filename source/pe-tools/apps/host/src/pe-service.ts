// pe-service.ts — the SDK-owned TypeScript client for the Pe service primitive (SDK-LEDGER A10).
//
// Service-file schema version: 1
// OWNED BY Pe.Revit.Sdk — DO NOT FORK. Copy this file verbatim into a consumer; the SDK ships it
// inside the Pe.Revit.Sdk nupkg under clients/ts/ so there is exactly ONE implementation per language
// (this mirrors Pe.Revit.Loader's C# InstalledProduct.EnsureRunning / ServiceFile byte-for-byte in
// behaviour). Dependency-free — Node stdlib only (fs/promises, path, child_process, crypto) plus the
// global fetch/AbortSignal (Node 18+).
//
// The runtime service file the SERVICE writes when it binds and deletes on graceful shutdown:
//   <appBase>/state/service/<name>.json = { pid, port, version, lane, token }
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
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";

export const SERVICE_FILE_SCHEMA_VERSION = 1;
const SHUTDOWN_TOKEN_HEADER = "x-pe-service-token";

export type ServiceTier = "managed" | "plain";

/** The runtime service file: { pid, port, version, lane, token }. `port` is the port actually bound. */
export interface ServiceFile {
  readonly pid: number;
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
  /** managed = our own exe (token shutdown); plain = third-party/sidecar (pid-kill). */
  readonly tier: ServiceTier;
  /** Expected version; compared to the file's version. Omit to skip the version check (unversioned). */
  readonly expectedVersion?: string;
  /** Expected lane ("installed" | "dev"); compared to the file's lane. */
  readonly lane: string;
  /** Startup wait budget in ms (default 15000). One pass — the CALLER retries on its own backoff. */
  readonly timeoutMs?: number;
  /** Extra args for the spawned entry (default none). */
  readonly spawnArgs?: readonly string[];
  /** Extra env for the spawned entry (merged over process.env; PE_LANE is set from `lane`). */
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

export function serviceFilePath(appBase: string, name: string): string {
  return join(appBase, "state", "service", `${name}.json`);
}

/** Read the service file (null when absent/unparseable/missing pid|port — never throws). */
export async function readServiceFile(appBase: string, name: string): Promise<ServiceFile | null> {
  const path = serviceFilePath(appBase, name);
  try {
    if (!existsSync(path)) return null;
    const raw = JSON.parse(await readFile(path, "utf8")) as Partial<ServiceFile>;
    if (typeof raw.pid !== "number" || typeof raw.port !== "number") return null;
    return {
      pid: raw.pid,
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
export async function writeServiceFile(appBase: string, name: string, file: ServiceFile): Promise<void> {
  const path = serviceFilePath(appBase, name);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(file, null, 2)}\n`, "utf8");
}

/** Delete the service file (services call this on graceful shutdown). Best-effort. */
export async function deleteServiceFile(appBase: string, name: string): Promise<void> {
  await rm(serviceFilePath(appBase, name), { force: true }).catch(() => {});
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
  const existing = await readServiceFile(appBase, name);
  if (existing) {
    if (await probeHealth(existing.port, opts.health)) {
      if (matches(existing, opts.expectedVersion, opts.lane)) return { state: "running", file: existing };
      await shutDown(appBase, existing, opts); // healthy but stale/wrong-lane ⇒ replace it
    } else {
      await killByPid(appBase, existing.pid); // recorded but not answering ⇒ dead/orphaned; clear it out
    }
    await deleteServiceFile(appBase, name); // let the freshly spawned service write a clean file
  }
  return spawnAndWait(appBase, name, opts);
}

function matches(file: ServiceFile, expectedVersion: string | undefined, lane: string): boolean {
  const versionOk = expectedVersion === undefined || file.version === expectedVersion;
  return versionOk && file.lane.toLowerCase() === lane.toLowerCase();
}

async function shutDown(appBase: string, file: ServiceFile, opts: EnsureRunningOptions): Promise<void> {
  if (
    opts.tier === "managed" &&
    opts.shutdown &&
    file.token &&
    (await requestShutdown(file.port, opts.shutdown, file.token)) &&
    (await waitForPortRelease(file.port, opts.health))
  )
    return;
  await killByPid(appBase, file.pid); // plain, or graceful stop unavailable/refused/timed out
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
    return { state: "failed", reason: `failed to open service log '${logPath}': ${describe(error)}` };
  }
  try {
    const child = spawn(opts.entryPath, [...(opts.spawnArgs ?? [])], {
      cwd: dirname(opts.entryPath),
      detached: true,
      stdio: ["ignore", logFd, logFd],
      env: { ...process.env, PE_LANE: opts.lane, ...opts.spawnEnv },
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
  return { state: "failed", reason: `'${name}' did not become healthy within ${(timeoutMs / 1000).toFixed(1)}s` };
}

async function probeHealth(port: number, healthPath: string): Promise<boolean> {
  if (!healthPath) return false;
  try {
    const response = await fetch(`http://127.0.0.1:${port}${healthPath}`, {
      signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS),
    });
    return response.status < 400;
  } catch {
    return false;
  }
}

async function requestShutdown(port: number, shutdownPath: string, token: string): Promise<boolean> {
  try {
    const response = await fetch(`http://127.0.0.1:${port}${shutdownPath}`, {
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
async function killByPid(appBase: string, pid: number): Promise<boolean> {
  if (!(await pidIsAlive(pid))) return true; // already gone
  const image = await pidImagePath(pid);
  if (!image) return false; // cannot verify ⇒ do not kill
  if (!withinRoot(image, appBase)) return false; // not ours — innocent pid reuse
  try {
    process.kill(pid);
  } catch {
    return false;
  }
  const deadline = Date.now() + 2_000;
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

/** Resolve a pid's executable image path (Windows: PowerShell Get-Process). null if unknown. */
async function pidImagePath(pid: number): Promise<string | null> {
  if (process.platform !== "win32") return null; // the SDK targets Windows; other platforms: cannot verify
  try {
    const { execFile } = await import("node:child_process");
    return await new Promise<string | null>((resolve) => {
      execFile(
        "powershell",
        ["-NoProfile", "-NonInteractive", "-Command", `(Get-Process -Id ${pid}).Path`],
        { timeout: 3_000 },
        (error, stdout) => resolve(error ? null : stdout.trim() || null),
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
