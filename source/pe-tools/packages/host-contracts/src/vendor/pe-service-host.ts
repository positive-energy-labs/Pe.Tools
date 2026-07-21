// pe-service-host.ts — the SDK-owned serve-side helper for a managed Pe service (SDK-LEDGER A10 / D3).
//
// OWNED BY Pe.Revit.Sdk — DO NOT FORK. Copy this file verbatim into a consumer alongside its sibling
// pe-service.ts; the SDK ships it inside the Pe.Revit.Sdk nupkg under clients/ts/ so there is exactly ONE
// implementation per language. Dependency-free — Node stdlib only, plus its one canonical sibling
// ./pe-service. It imports NOTHING else.
//
// PRIMITIVES-ONLY. This helper does NOT own an HTTP server, routes, or a framework. A managed host binds
// its own loopback port and mounts its own shutdown route; this helper owns the identity/eviction seam
// around that:
//   - claim-on-startup: build the caller's identity (createServiceFile), verify the prior owner
//     (pid + start-time, via the SDK's isRecordedOwnerAlive), evict it end-to-end when policy allows,
//     write the service file on bind, and delete it on graceful exit;
//   - eviction end-to-end: reading the prior owner's file, POSTing its shutdown route with ITS token
//     (header `x-pe-service-token`, SDK-owned), waiting for the port to release / the process to exit,
//     then claiming — all delegated to pe-service.ts `takeOver`, which mirrors C#
//     `InstalledProduct.TakeOver` / `EnsureRunning`→`ShutDown` byte-for-byte in behaviour;
//   - token validation for the product's shutdown route (a thin binding over `isAuthorizedShutdown`).
//
// REPLACEMENT POLICY IS DATA, not probe logic. The claimant declares which foreign-owner lanes it may
// evict; the claim call applies that data. The preserved rule (see {@link hostReplacementPolicy}): a dev
// host replaces an installed host automatically; a dev host replaces another dev host only with an
// explicit takeover flag.

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { dirname, join } from "node:path";
import {
  createServiceFile,
  createServiceToken,
  deleteServiceFile,
  discoverService,
  isAuthorizedShutdown,
  isRecordedOwnerAlive,
  readServiceFile,
  takeOver,
  type ServiceFile,
  type ServiceTier,
} from "./pe-service.ts";

// Re-exported so a consumer mints tokens and validates shutdowns through this one helper rather than
// reaching past it into pe-service directly.
export { createServiceToken, isAuthorizedShutdown } from "./pe-service.ts";

/** Which foreign-owner lanes a claimant may evict on sight. Data, applied by {@link claimServiceHost}. */
export interface ReplacementPolicy {
  /** Lowercased lane names whose live incumbent this claimant may displace. */
  readonly evicts: readonly string[];
}

/**
 * The preserved replacement policy (D3): a dev host replaces an installed host automatically; a dev host
 * replaces another dev host only with the explicit takeover flag; an installed host reclaims a stale
 * installed owner (it is spawned precisely to become the sole owner). `takeOverHost` is the product's
 * `--take-over-host` flag.
 */
export function hostReplacementPolicy(lane: string, takeOverHost = false): ReplacementPolicy {
  if (lane.toLowerCase() === "dev")
    return { evicts: takeOverHost ? ["installed", "dev"] : ["installed"] };
  return { evicts: ["installed"] };
}

/** The claim descriptor. The caller has ALREADY bound its loopback port before claiming. */
export interface ServiceHostDescriptor {
  /** The service name — `state/service/<name>.json`. */
  readonly name: string;
  /** This host's lane ("installed" | "dev"). */
  readonly lane: string;
  /** This host's version — recorded in the file, matched by installed-lane supervisors. */
  readonly version: string;
  /** The loopback port this host bound before claiming (authoritative — discovery is file-based). */
  readonly port: number;
  /** This host's own image (the D2 identity signal recorded in the file). */
  readonly executablePath: string;
  /** Dev-lane checkout this host runs from (recorded as `sourceRoot`). */
  readonly sourceRoot?: string;
  /** The product's shutdown route path, e.g. "/admin/shutdown" — reused to evict a prior owner. */
  readonly shutdown: string;
  /** Which foreign-owner lanes this host may evict (see {@link hostReplacementPolicy}). */
  readonly policy: ReplacementPolicy;
  /** managed (default, token shutdown) vs plain. A plain incumbent cannot be taken over cooperatively. */
  readonly tier?: ServiceTier;
  /** Eviction wait budget in ms (default 15000). */
  readonly timeoutMs?: number;
  /** Invoked (best-effort) with the evicted owner's file when a live incumbent was displaced. */
  readonly onEvict?: (evicted: ServiceFile) => void;
}

/** The live claim: the written identity plus a graceful-exit release that deletes the file. */
export interface ServiceHostHandle {
  /** The identity this host installed — the service file now names it. */
  readonly serviceFile: ServiceFile;
  /** Delete this host's service file (call on graceful shutdown). Compare-and-delete: never removes a
   * successor's identity. Idempotent. */
  release(): Promise<void>;
}

/** The honest outcomes of {@link claimServiceHost} — a value, never an exception, for every expected state. */
export type ClaimResult =
  | { readonly claimed: true; readonly handle: ServiceHostHandle }
  | { readonly claimed: false; readonly reason: string; readonly incumbent?: ServiceFile };

/**
 * Claim sole ownership of service `<name>` under `appBase` for the calling (already port-bound) host.
 *
 *   1. Build this host's identity ({@link createServiceFile}) with a fresh per-launch shutdown token.
 *   2. POLICY GATE: if a verified-live foreign owner holds the file and its lane is NOT in
 *      `descriptor.policy.evicts`, refuse WITHOUT displacing it ⇒ `{ claimed: false, incumbent }`.
 *   3. Otherwise delegate the atomic claim+eviction to pe-service.ts `takeOver`: no live owner ⇒ write
 *      ours; a live evictable owner ⇒ POST its shutdown route with ITS token, wait for verified exit,
 *      then write ours (firing `onEvict`). A refusal/timeout ⇒ `{ claimed: false }`.
 *
 * On success the returned handle's `serviceFile.token` is what the product's shutdown route must accept
 * (see {@link authorizeShutdownFor}). Never throws for expected states.
 */
export async function claimServiceHost(
  appBase: string,
  descriptor: ServiceHostDescriptor,
): Promise<ClaimResult> {
  const identity = createServiceFile(
    descriptor.port,
    descriptor.version,
    descriptor.lane,
    createServiceToken(),
    descriptor.executablePath,
    descriptor.sourceRoot,
  );

  // Policy gate, applied on the current incumbent BEFORE any displacement. A dead/stale owner is not a
  // conflict — takeOver claims over it below regardless of policy.
  const existing = await readServiceFile(appBase, descriptor.name);
  if (
    existing &&
    existing.instanceId !== identity.instanceId &&
    (await isRecordedOwnerAlive(existing)) &&
    !mayEvict(descriptor.policy, existing.lane)
  )
    return {
      claimed: false,
      reason:
        `a live ${existing.lane} host (pid ${existing.pid}) holds '${descriptor.name}'; ` +
        `not evictable by a ${descriptor.lane} host under policy`,
      incumbent: existing,
    };

  const result = await takeOver(appBase, descriptor.name, identity, {
    shutdown: descriptor.shutdown,
    tier: descriptor.tier,
    timeoutMs: descriptor.timeoutMs,
  });
  if (result.outcome === "owner-stopped-and-claimed" && existing) {
    try {
      descriptor.onEvict?.(existing);
    } catch {}
  }
  if (result.outcome === "no-current-owner" || result.outcome === "owner-stopped-and-claimed")
    return { claimed: true, handle: makeHandle(appBase, descriptor.name, result.file) };
  return { claimed: false, reason: result.reason };
}

function mayEvict(policy: ReplacementPolicy, incumbentLane: string): boolean {
  return policy.evicts.includes(incumbentLane.toLowerCase());
}

function makeHandle(appBase: string, name: string, serviceFile: ServiceFile): ServiceHostHandle {
  return {
    serviceFile,
    release: () => deleteServiceFile(appBase, name, serviceFile.instanceId).then(() => {}),
  };
}

// --- Port preference ----------------------------------------------------------------------------
// A claimant binds BEFORE claiming (the bound port is authoritative), but stable URLs across
// restarts matter for browsers and long-lived callers. The preference file
// `state/service/<name>.port` remembers the last bound port; it is a HINT (like a manifest's
// preferredPort), never an address — discovery stays file-based on the service file.

function portPreferencePath(appBase: string, name: string): string {
  return join(appBase, "state", "service", `${name}.port`);
}

/**
 * Choose the port a claimant should bind BEFORE claiming `name`:
 *   - a verified-live same-name incumbent ⇒ 0 — this launch is a takeover candidate and must bind
 *     elsewhere first (claim, evict, then serve);
 *   - otherwise the remembered last-bound port (falling back to `preferredPort`) when it is free;
 *   - taken or invalid ⇒ 0 (ephemeral).
 * Probe-then-bind TOCTOU is accepted: a lost race fails the caller's own bind loudly, which is the
 * honest outcome for two first-ever claimants racing one preferred port.
 */
export async function chooseServicePort(
  appBase: string,
  name: string,
  preferredPort: number,
): Promise<number> {
  if (await discoverService(appBase, name, { verifyOwner: true })) return 0;
  let preferred = preferredPort;
  try {
    const remembered = Number.parseInt(
      (await readFile(portPreferencePath(appBase, name), "utf8")).trim(),
      10,
    );
    if (Number.isInteger(remembered) && remembered > 0 && remembered <= 65_535)
      preferred = remembered;
  } catch {}
  if (!Number.isInteger(preferred) || preferred <= 0 || preferred > 65_535) return 0;
  return (await portIsFree(preferred)) ? preferred : 0;
}

/** Record the ACTUALLY bound port as the preference for the next launch. Call after a successful claim. */
export async function rememberServicePort(
  appBase: string,
  name: string,
  port: number,
): Promise<void> {
  const path = portPreferencePath(appBase, name);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, String(port), "utf8");
}

function portIsFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const probe = createServer();
    probe.once("error", () => resolve(false));
    probe.listen(port, "127.0.0.1", () => probe.close(() => resolve(true)));
  });
}

// --- Shutdown route helpers --------------------------------------------------------------------
// The product mounts its OWN shutdown route (its framework's) and delegates authorization here.

/**
 * Bind a shutdown authorizer to a live handle's token: the returned predicate is true only when an
 * inbound request carries this host's per-launch token (in the `x-pe-service-token` header OR a JSON
 * body `{ token }`). Mount it in the product's shutdown route.
 */
export function authorizeShutdownFor(
  handle: ServiceHostHandle,
): (headers: Record<string, string | string[] | undefined>, body: unknown) => boolean {
  return (headers, body) => isAuthorizedShutdown(headers, body, handle.serviceFile.token);
}
