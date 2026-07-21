/* eslint-disable no-control-regex -- Windows rejects ASCII control characters in service names. */
// pe-service.ts — the SDK-owned TypeScript client for the Pe service primitive (SDK-LEDGER A10).
//
// Service-file schema version: 2
// OWNED BY Pe.Revit.Sdk — DO NOT FORK. Copy this file verbatim into a consumer; the SDK ships it
// inside the Pe.Revit.Sdk nupkg under clients/ts/ so there is exactly ONE implementation per language
// (this mirrors Pe.Revit.Loader's C# InstalledProduct.EnsureRunning / TakeOver / ServiceFile byte-for-byte
// in behaviour). Dependency-free — Node stdlib only (fs/promises, path, child_process, crypto) plus the
// global fetch/AbortSignal (Node 18+).
//
// The runtime service file the SERVICE writes when it binds and deletes on graceful shutdown:
//   <appBase>/state/service/<name>.json =
//     { schemaVersion, instanceId, pid, processStartUtc, port, version, lane, token }
//   <appBase>/state/service/<name>.log  = spawned stdout+stderr plus supervisor breadcrumbs (append-only)
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
import { appendFileSync, closeSync, existsSync, mkdirSync, openSync, readFileSync } from "node:fs";
import { mkdir, open, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { createHash, randomUUID } from "node:crypto";

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
  /**
   * D2 (optional): the running service image. When present it participates in {@link ensureRunning}'s
   * identity match; when ABSENT the file is treated as no-match — spawn/replace fresh (the file is
   * rewritten on every host bind, so a thin-shape file self-heals in one launch). Emitted only when set.
   */
  readonly executablePath?: string;
  /** D2 (optional, dev lane): the checkout a dev host runs from. Emitted only when set. */
  readonly sourceRoot?: string;
}

/**
 * A non-exe launch spelling for {@link ensureRunning} — how a SOURCE service starts (`vp run …`,
 * `pnpm dev`, …). The spawned process must still satisfy the service contract: bind loopback, claim
 * its service file with the ACTUAL bound port, delete it on graceful exit.
 */
export interface ServiceSpawnCommand {
  /** The command (absolute path, or a PATH-resolved name when `shell` is set — .cmd shims need shell). */
  readonly command: string;
  readonly args?: readonly string[];
  /** Working directory for the spawn — a dev checkout root, typically. */
  readonly cwd: string;
  /** Run through the platform shell (required for .cmd/.bat shims on Windows). */
  readonly shell?: boolean;
}

export interface EnsureRunningOptions {
  /**
   * The resolved launchable entry (an absolute path to the service exe). Spawned detached. Optional
   * when `spawnCommand` supplies the launch spelling instead; still used for the D2 identity match
   * when present.
   */
  readonly entryPath?: string;
  /** Source-lane launch spelling; when present it is spawned INSTEAD of `entryPath`. */
  readonly spawnCommand?: ServiceSpawnCommand;
  /**
   * Source-lane identity match: the service file matches when its `sourceRoot` names this checkout
   * (case/separator-insensitive) and the lane/version checks pass — replacing the `executablePath`
   * equality rule, which cannot hold for source runs (their image is the runtime, not the service).
   */
  readonly matchSourceRoot?: string;
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

export interface TakeOverOptions {
  /** POST path for a token-authenticated graceful stop, e.g. "/admin/shutdown". Loopback absolute path. */
  readonly shutdown: string;
  /** managed (default, token shutdown) vs plain. A plain owner cannot be taken over cooperatively. */
  readonly tier?: ServiceTier;
  /** Wait budget in ms for the incumbent to exit after it accepts the shutdown (default 15000). */
  readonly timeoutMs?: number;
}

/**
 * The outcomes of {@link takeOver} — the cooperative "become the sole owner" primitive. Mirrors
 * `Pe.Revit.Loader.TakeOverResult` on the C# side. On the two claimed outcomes `file` is the caller's
 * installed identity — the service file now names it; on the conflict outcomes `reason` explains why the
 * caller is NOT the owner and the incumbent (if any) still holds the file.
 */
export type TakeOverResult =
  | { readonly outcome: "no-current-owner"; readonly file: ServiceFile }
  | { readonly outcome: "owner-stopped-and-claimed"; readonly file: ServiceFile }
  | { readonly outcome: "owner-refused"; readonly reason: string }
  | { readonly outcome: "owner-unresponsive-after-timeout"; readonly reason: string }
  | { readonly outcome: "failed"; readonly reason: string };

const HEALTH_TIMEOUT_MS = 500;
const SHUTDOWN_TIMEOUT_MS = 1_000;
const PORT_RELEASE_TIMEOUT_MS = 5_000;
const POLL_INTERVAL_MS = 250;
const DEFAULT_STARTUP_TIMEOUT_MS = 15_000;
const LEASE_PATH_ENV = "PE_SERVICE_LEASE_PATH";
const LEASE_TOKEN_ENV = "PE_SERVICE_LEASE_TOKEN";

interface ServiceLease {
  readonly path: string;
  readonly token: string;
  readonly inherited: boolean;
}

async function acquireServiceLease(
  appBase: string,
  name: string,
  timeoutMs: number,
): Promise<ServiceLease | null> {
  const path = join(appBase, "state", "service", `${name}.lock`);
  await mkdir(dirname(path), { recursive: true });
  const inheritedPath = process.env[LEASE_PATH_ENV];
  const inheritedToken = process.env[LEASE_TOKEN_ENV];
  // appBase may be a junction alias, so verify the inherited capability against this path's lock
  // contents instead of requiring path-string equality.
  if (inheritedPath && inheritedToken) {
    try {
      const owner = JSON.parse(await readFile(path, "utf8")) as { token?: unknown };
      if (owner.token === inheritedToken) {
        delete process.env[LEASE_PATH_ENV];
        delete process.env[LEASE_TOKEN_ENV];
        return { path, token: inheritedToken, inherited: true };
      }
    } catch {}
  }
  const deadline = Date.now() + timeoutMs;
  do {
    const token = randomUUID();
    try {
      const handle = await open(path, "wx");
      try {
        await handle.writeFile(
          JSON.stringify({ pid: process.pid, token, acquiredUtc: new Date().toISOString() }),
          "utf8",
        );
      } finally {
        await handle.close();
      }
      return { path, token, inherited: false };
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
  if (lease.inherited) return;
  try {
    const owner = JSON.parse(await readFile(lease.path, "utf8")) as { token?: unknown };
    if (owner.token === lease.token) await rm(lease.path, { force: true });
  } catch {}
}

async function describeLeaseOwner(path: string): Promise<string> {
  try {
    const owner = JSON.parse(await readFile(path, "utf8")) as {
      pid?: unknown;
      acquiredUtc?: unknown;
    };
    return (
      ` (lock '${path}' owner pid ${typeof owner.pid === "number" ? owner.pid : "unknown"}` +
      `${typeof owner.acquiredUtc === "string" ? `, acquired ${owner.acquiredUtc}` : ""})`
    );
  } catch (error) {
    return ` (lock '${path}' owner unreadable: ${describe(error)})`;
  }
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
    return validateServiceFile(JSON.parse(await readFile(path, "utf8")) as Partial<ServiceFile>);
  } catch {
    return null;
  }
}

/** Sync {@link readServiceFile} for synchronous resolution paths (CLI arg defaults etc.). */
export function readServiceFileSync(appBase: string, name: string): ServiceFile | null {
  const path = serviceFilePath(appBase, name);
  try {
    if (!existsSync(path)) return null;
    return validateServiceFile(JSON.parse(readFileSync(path, "utf8")) as Partial<ServiceFile>);
  } catch {
    return null;
  }
}

function validateServiceFile(raw: Partial<ServiceFile>): ServiceFile | null {
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
  // executablePath / sourceRoot are additive (D2): absent ⇒ omitted (never a rejection), and the key
  // order (after token) mirrors the C# emitter so the cross-language byte-golden holds.
  return {
    schemaVersion: SERVICE_FILE_SCHEMA_VERSION,
    instanceId: raw.instanceId,
    pid: raw.pid,
    processStartUtc: raw.processStartUtc,
    port: raw.port,
    version: typeof raw.version === "string" ? raw.version : "",
    lane: typeof raw.lane === "string" ? raw.lane : "",
    token: typeof raw.token === "string" ? raw.token : "",
    ...(typeof raw.executablePath === "string" ? { executablePath: raw.executablePath } : {}),
    ...(typeof raw.sourceRoot === "string" ? { sourceRoot: raw.sourceRoot } : {}),
  };
}

/**
 * Discovery projection over the service file: the file IFF its recorded owner still looks alive.
 * The default check is pid-existence only — cheap enough for per-call URL resolution; a reused pid
 * can alias briefly, and the caller's next HTTP request is the real probe. Pass `verifyOwner: true`
 * for the full pid+start-time verification (spawns a process query — reserve it for decisions that
 * must never mistake a reused pid for the owner, e.g. port choice before a claim). A dead owner's
 * leftover file reads as null — never as an address.
 */
export async function discoverService(
  appBase: string,
  name: string,
  opts?: { readonly verifyOwner?: boolean },
): Promise<ServiceFile | null> {
  const file = await readServiceFile(appBase, name);
  if (!file) return null;
  if (opts?.verifyOwner) return (await recordedProcessAlive(file)) ? file : null;
  return (await pidIsAlive(file.pid)) ? file : null;
}

/** Sync {@link discoverService} (pid-existence check only) for synchronous resolution paths. */
export function discoverServiceSync(appBase: string, name: string): ServiceFile | null {
  const file = readServiceFileSync(appBase, name);
  if (!file) return null;
  try {
    process.kill(file.pid, 0); // signal 0 = existence probe
    return file;
  } catch {
    return null;
  }
}

/**
 * Delete service files under `appBase` whose recorded owner is verifiably gone (full pid+start-time
 * verification — a live owner is never swept, and a reused pid never protects a corpse). Scope with
 * `prefix` (service-name prefix) and `exclude` (exact names to leave alone, e.g. the caller's own
 * claim). Unreadable files are left in place — deletion needs proof of death, and an unparseable
 * file is a diagnostic (`pe-revit service list` flags it), not proof. `.port` preference and `.log`
 * files are untouched. Returns the swept names.
 */
export async function sweepDeadServiceFiles(
  appBase: string,
  opts?: { readonly prefix?: string; readonly exclude?: readonly string[] },
): Promise<string[]> {
  let entries: string[];
  try {
    entries = await readdir(join(appBase, "state", "service"));
  } catch {
    return [];
  }
  const swept: string[] = [];
  for (const entry of entries) {
    if (!entry.endsWith(".json")) continue;
    const name = entry.slice(0, -".json".length);
    if (!isSafeServiceName(name)) continue;
    if (opts?.prefix !== undefined && !name.startsWith(opts.prefix)) continue;
    if (opts?.exclude?.includes(name)) continue;
    const file = await readServiceFile(appBase, name);
    if (!file || (await recordedProcessAlive(file))) continue;
    await rm(serviceFilePath(appBase, name), { force: true }).catch(() => {});
    swept.push(name);
  }
  return swept;
}

// --- Worktree-scoped service identity ------------------------------------------------------------
// A service run from SOURCE derives its name from its checkout root so multiple worktrees coexist
// under one appBase: `<baseName>-source-<sha256(normalized root)[:12]>`. The normalization and hash
// are a cross-language byte contract (clients/contract-vectors.json `sourceServiceName` cases) —
// the C# client (clients/csharp) MUST produce identical names or a supervisor polls a file its
// service will never write.

/** Canonical checkout-root form for identity hashing: absolute, forward slashes, no trailing slash, lowercase. */
export function normalizeSourceRoot(sourceRoot: string): string {
  return resolve(sourceRoot).replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
}

/** Worktree-scoped service name for a source-run service: `<baseName>-source-<12 hex>`. */
export function sourceServiceName(baseName: string, sourceRoot: string): string {
  const digest = createHash("sha256")
    .update(normalizeSourceRoot(sourceRoot), "utf8")
    .digest("hex")
    .slice(0, 12);
  return `${baseName}-source-${digest}`;
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

/**
 * Compare-and-delete the named launch's service file. Idempotent by intent: the goal is "no file naming
 * `instanceId` remains", so an already-absent file is success, a file naming a SUCCESSOR is left
 * untouched (returns false — never delete another launch's identity), and a concurrent delete that wins
 * the race (the file vanishes mid-delete) is also success. This tolerance is what lets an exiting owner's
 * delete-on-exit and a taker's post-verified-exit cleanup run without either racing the other into a
 * spurious failure.
 */
export async function deleteServiceFile(
  appBase: string,
  name: string,
  instanceId: string,
): Promise<boolean> {
  const current = await readServiceFile(appBase, name);
  if (!current) return true; // already absent — the delete's goal is reached
  if (current.instanceId !== instanceId) return false; // a successor owns it
  try {
    await rm(serviceFilePath(appBase, name));
    return true;
  } catch {
    return (await readServiceFile(appBase, name)) === null; // a concurrent compare-and-delete won ⇒ still success
  }
}

/**
 * Create a schema-v2 identity for the calling service after it has bound its loopback port.
 * `executablePath` (D2) is the running service image — pass the resolved launchable so
 * {@link ensureRunning} can match on it; `sourceRoot` records a dev-lane checkout. Both are optional
 * and, when omitted, produce a thin file (which {@link ensureRunning} treats as no-match).
 */
export function createServiceFile(
  port: number,
  version: string,
  lane: string,
  token: string,
  executablePath?: string,
  sourceRoot?: string,
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
    ...(executablePath !== undefined ? { executablePath } : {}),
    ...(sourceRoot !== undefined ? { sourceRoot } : {}),
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
  if (opts.entryPath === undefined && opts.spawnCommand === undefined)
    return { state: "failed", reason: "ensureRunning needs an entryPath or a spawnCommand" };
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
  if (!lease) {
    const path = join(appBase, "state", "service", `${name}.lock`);
    return {
      state: "failed",
      reason: `service '${name}' is busy in another supervisor${await describeLeaseOwner(path)}`,
    };
  }
  try {
    const existing = await readServiceFile(appBase, name);
    if (existing) {
      const stopped = (await probeHealth(existing.port, opts.health))
        ? matches(existing, opts.expectedVersion, opts.lane, opts.entryPath, opts.matchSourceRoot)
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
    return await spawnAndWait(appBase, name, opts, lease);
  } finally {
    await releaseServiceLease(lease);
  }
}

/**
 * The singleton-host takeover primitive: make the CALLING process the sole owner of service `name`,
 * displacing whatever verified owner currently holds it, and install `identity` (the caller's OWN
 * already-bound service file — bind the loopback port and mint the token first, then
 * {@link createServiceFile}). Unlike {@link ensureRunning} this spawns nothing: the caller is itself the
 * new host. The whole transition runs under the same one-writer supervisor lease ensureRunning uses:
 *   1. no verified owner (file absent, already ours, or the recorded pid+start is gone) ⇒ clear any stale
 *      file and write our identity ⇒ "no-current-owner";
 *   2. a live foreign owner ⇒ POST the shutdown endpoint with the owner's file token; a refusal
 *      (plain tier / no token / non-2xx) ⇒ "owner-refused" (takeover never force-kills — the caller
 *      decides whether to escalate);
 *   3. shutdown accepted ⇒ wait up to timeoutMs for the recorded process to verifiably exit (pid gone, or
 *      the pid reused with a different start time); still alive ⇒ "owner-unresponsive-after-timeout";
 *   4. verified exit ⇒ compare-and-delete whatever the exiting owner did not remove, then write our
 *      identity — all before the lease is released, so no supervisor observes a missing-or-foreign file
 *      mid-handoff ⇒ "owner-stopped-and-claimed".
 * Never throws for expected states.
 */
export async function takeOver(
  appBase: string,
  name: string,
  identity: ServiceFile,
  opts: TakeOverOptions,
): Promise<TakeOverResult> {
  if (!isSafeServiceName(name))
    return { outcome: "failed", reason: `payload '${name}' is not a safe service name` };
  if (!isLoopbackPath(opts.shutdown))
    return {
      outcome: "failed",
      reason: "service shutdown must be a loopback absolute path beginning with one '/'",
    };
  const timeoutMs = opts.timeoutMs ?? DEFAULT_STARTUP_TIMEOUT_MS;
  const lease = await acquireServiceLease(appBase, name, timeoutMs);
  if (!lease) {
    const path = join(appBase, "state", "service", `${name}.lock`);
    return {
      outcome: "failed",
      reason: `service '${name}' is busy in another supervisor${await describeLeaseOwner(path)}`,
    };
  }
  try {
    const existing = await readServiceFile(appBase, name);
    if (
      !existing ||
      existing.instanceId === identity.instanceId ||
      !(await recordedProcessAlive(existing))
    ) {
      // No verified foreign owner: clear a stale file naming a dead owner, then install our identity.
      if (existing && existing.instanceId !== identity.instanceId)
        await deleteServiceFile(appBase, name, existing.instanceId);
      await writeServiceFile(appBase, name, identity);
      return { outcome: "no-current-owner", file: identity };
    }
    // A live, foreign owner holds the service — cooperative token shutdown only (never force-kill).
    if ((opts.tier ?? "managed") !== "managed" || !existing.token)
      return {
        outcome: "owner-refused",
        reason: `service '${name}' owner (pid ${existing.pid}) has no token shutdown route`,
      };
    if (!(await requestShutdown(existing.port, opts.shutdown, existing.token)))
      return {
        outcome: "owner-refused",
        reason: `service '${name}' owner (pid ${existing.pid}) refused the shutdown request`,
      };
    if (!(await waitForVerifiedExit(existing, timeoutMs)))
      return {
        outcome: "owner-unresponsive-after-timeout",
        reason:
          `service '${name}' owner (pid ${existing.pid}) did not exit within ` +
          `${(timeoutMs / 1000).toFixed(1)}s of an accepted shutdown`,
      };
    // Verified exit: compare-and-delete whatever the exiting owner did not remove, then install ours.
    await deleteServiceFile(appBase, name, existing.instanceId);
    await writeServiceFile(appBase, name, identity);
    return { outcome: "owner-stopped-and-claimed", file: identity };
  } finally {
    await releaseServiceLease(lease);
  }
}

/**
 * True iff the recorded pid is a live process whose start time matches the file's `processStartUtc`
 * (within clock slop). A vanished pid, a pid reused by an unrelated process (start-time mismatch), or a
 * process whose identity cannot be verified (non-Windows: {@link pidIdentity} returns null) all read as
 * "not the owner" — the takeover treats them as no live owner rather than blocking on an unverifiable pid.
 */
async function recordedProcessAlive(file: ServiceFile): Promise<boolean> {
  if (!(await pidIsAlive(file.pid))) return false;
  const identity = await pidIdentity(file.pid);
  if (!identity) return false;
  return Math.abs(Date.parse(identity.startUtc) - Date.parse(file.processStartUtc)) <= 2_000;
}

/**
 * True iff <paramref name="file"/> still names a live process whose recorded (pid, processStartUtc) is
 * the one running now — the same pid+start-time verification {@link takeOver} uses to decide whether a
 * prior owner is a real incumbent. Exposed for serve-side claimants (pe-service-host.ts) that gate an
 * eviction on the incumbent's lane BEFORE displacing it. A vanished pid, a reused pid, or an
 * unverifiable process all read false (no live owner).
 */
export function isRecordedOwnerAlive(file: ServiceFile): Promise<boolean> {
  return recordedProcessAlive(file);
}

async function waitForVerifiedExit(file: ServiceFile, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!(await recordedProcessAlive(file))) return true;
    await delay(POLL_INTERVAL_MS);
  }
  return !(await recordedProcessAlive(file));
}

// D2 identity match. A file WITHOUT executablePath never matches — the pre-D2 conservative rule is
// "spawn/replace fresh", and the replacement rewrites the file with the field so it self-heals in one
// launch. When present, executablePath must equal the resolved launchable (case/separator-insensitive)
// on top of the version+lane check. Mirrors Pe.Revit.Loader.InstalledProduct.Matches.
// Source-lane variant: `matchSourceRoot` swaps the executablePath rule for a `sourceRoot` equality —
// a source service's image is its runtime (node/vp), so the checkout IS the identity signal.
function matches(
  file: ServiceFile,
  expectedVersion: string | undefined,
  lane: string,
  expectedExecutablePath: string | undefined,
  matchSourceRoot?: string,
): boolean {
  const versionOk = expectedVersion === undefined || file.version === expectedVersion;
  const laneOk = file.lane.toLowerCase() === lane.toLowerCase();
  if (matchSourceRoot !== undefined)
    return (
      file.sourceRoot !== undefined &&
      samePath(file.sourceRoot, matchSourceRoot) &&
      versionOk &&
      laneOk
    );
  if (file.executablePath === undefined) return false;
  if (
    expectedExecutablePath !== undefined &&
    !samePath(file.executablePath, expectedExecutablePath)
  )
    return false;
  return versionOk && laneOk;
}

function samePath(a: string, b: string): boolean {
  const normalize = (p: string) => p.replace(/\//g, "\\").replace(/\\+$/, "").toLowerCase();
  return normalize(a) === normalize(b);
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
  lease: ServiceLease,
): Promise<EnsureRunningResult> {
  // Capture detached stdout+stderr and preserve every retry with a supervisor breadcrumb.
  const launchSpelling = opts.spawnCommand
    ? `${opts.spawnCommand.command} ${(opts.spawnCommand.args ?? []).join(" ")}`.trim()
    : opts.entryPath!;
  const logPath = join(appBase, "state", "service", `${name}.log`);
  let logFd: number;
  try {
    mkdirSync(dirname(logPath), { recursive: true });
    appendFileSync(
      logPath,
      `\n[${new Date().toISOString()}] supervisor pid=${process.pid} spawning '${launchSpelling}' lane=${opts.lane}\n`,
      "utf8",
    );
    logFd = openSync(logPath, "a");
  } catch (error) {
    return {
      state: "failed",
      reason: `failed to open service log '${logPath}': ${describe(error)}`,
    };
  }
  let child: ReturnType<typeof spawn> | undefined;
  const childStartUtc = new Date().toISOString();
  try {
    const spawnEnv = {
      ...process.env,
      ...opts.spawnEnv,
      PE_LANE: opts.lane,
      [LEASE_PATH_ENV]: lease.path,
      [LEASE_TOKEN_ENV]: lease.token,
    };
    child = opts.spawnCommand
      ? spawn(opts.spawnCommand.command, [...(opts.spawnCommand.args ?? [])], {
          cwd: opts.spawnCommand.cwd,
          shell: opts.spawnCommand.shell ?? false,
          detached: true,
          stdio: ["ignore", logFd, logFd],
          env: spawnEnv,
        })
      : spawn(opts.entryPath!, [...(opts.spawnArgs ?? [])], {
          cwd: dirname(opts.entryPath!),
          detached: true,
          stdio: ["ignore", logFd, logFd],
          env: spawnEnv,
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
    return { state: "failed", reason: `failed to start '${launchSpelling}': ${describe(error)}` };
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
    if (matches(file, opts.expectedVersion, opts.lane, opts.entryPath, opts.matchSourceRoot))
      return { state: "started", file };
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
