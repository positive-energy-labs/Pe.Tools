import { lstat, readdir, readFile } from "node:fs/promises";
import type { Stats } from "node:fs";
import { createHash } from "node:crypto";
import { scriptPodMemberBounds } from "@pe/host-contracts/generated";
import { join, resolve, sep } from "node:path";
import { logPackageDiscovery } from "./pod-discovery-log.ts";
import { readPackageWork, type PackageCensus } from "./pod-capture.ts";

const metadataScanSlowMs = 500;
const witnessTickMs = 2_000;

/** Hash observation time governs trust, not byte identity. */
export function samePackageDiskSignature(a: string | undefined, b: string | undefined): boolean {
  if (a === b) return true;
  if (a === undefined || b === undefined) return false;
  const identity = (value: string) => { const rows: unknown[] = JSON.parse(value);
    return JSON.stringify(rows.map(row => Array.isArray(row) && row.length === 8 ? row.slice(0, 7) : row)); };
  return identity(a) === identity(b);
}

/** Retained rows are observations of identity only. Resolve them against the census at selection,
 * not the snapshot at arrival, so simultaneous requests cannot roll back another Pod's witness. */
export function resolvePackageDiskSignature(signature: string, previous: PackageCensus | undefined, roots: readonly string[]): string {
  const rows: unknown[][] = JSON.parse(signature);
  const before = previous?.signature ? packageDiskRows(previous.signature, roots) : new Map<string, unknown[][]>();
  const failures = new Map<string, string>();
  for (const pod of previous?.listing.packages ?? [])
    if (pod.discoveryFailure) failures.set(resolve(pod.directory), pod.discoveryFailure);
  return JSON.stringify(rows.flatMap(row => {
    if (!Array.isArray(row) || row[1] !== "retained") return [row];
    const retained = before.get(String(row[0])) ?? [];
    const failure = failures.get(String(row[0]));
    // A previous capture failure is retried when this Pod is used, never as a side effect
    // of reading a neighbour. Its last identity stays, but its bytes remain unavailable.
    if (failure && !retained.some(row => row[1] === "unavailable"))
      retained.push([row[0], "unavailable", failure]);
    const manifest = row[2];
    return retained.map(entry => Array.isArray(manifest) && entry[0] === manifest[0] ? manifest : entry);
  }));
}

export function packageDiskFailure(signature: string | undefined, directory: string): string | undefined {
  if (!signature) return undefined;
  const rows: unknown[] = JSON.parse(signature);
  const row = rows.find(row => Array.isArray(row) && row[0] === directory && row[1] === "unavailable");
  return Array.isArray(row) ? String(row[2]) : undefined;
}

/** Partition the same metadata witness by immediate Pod folder, without a second disk walk. */
export function packageDiskSignatures(signature: string, roots: readonly string[]): Map<string, string> {
  return new Map([...packageDiskRows(signature, roots)].map(([directory, entries]) => [directory, JSON.stringify(entries)]));
}

function packageDiskRows(signature: string, roots: readonly string[]): Map<string, unknown[][]> {
  const grouped = new Map<string, unknown[][]>();
  const prefixes = roots.map(root => `${resolve(root).replace(/[\\/]+$/, "")}${sep}`);
  const entries: unknown = JSON.parse(signature);
  if (!Array.isArray(entries)) return new Map();
  for (const entry of entries) {
    if (!Array.isArray(entry) || typeof entry[0] !== "string") continue;
    // Metadata rows already use resolved paths from this owner. Partition once, without
    // normalizing every member again or scanning all rows once per retained Pod.
    for (const prefix of prefixes) {
      if (!entry[0].startsWith(prefix)) continue;
      const end = entry[0].indexOf(sep, prefix.length);
      const directory = end === -1 ? entry[0] : entry[0].slice(0, end);
      const members = grouped.get(directory) ?? [];
      members.push(entry);
      grouped.set(directory, members);
      break;
    }
  }
  return grouped;
}

/** Only retained rows lack a new member observation. Missing/failed identities are observations too. */
export function observedPackageDirectories(signature: string | undefined, roots: readonly string[], previous?: PackageCensus): ReadonlySet<string> {
  const rows = signature ? packageDiskRows(signature, roots) : new Map<string, unknown[][]>();
  const retained = new Set([...rows].filter(([, entries]) => entries.some(row => row[1] === "retained")).map(([directory]) => directory));
  return new Set([...rows.keys(), ...(previous?.listing.packages.map(pod => resolve(pod.directory)) ?? [])]
    .filter(directory => !retained.has(directory)));
}

/** A completed capture must not silently omit a regular member the arrival walk saw. */
export function packageDiskFiles(signature: string): string[] {
  const entries: unknown = JSON.parse(signature);
  if (!Array.isArray(entries)) return [];
  return entries.flatMap(entry => Array.isArray(entry) && typeof entry[0] === "string" &&
    typeof entry[1] === "number" && (entry[1] & 0o170000) === 0o100000 ? [entry[0]] : []);
}

/** Metadata only. Unreadable metadata never authorizes reuse; a missing root is a known state. */
export async function podsDiskSignature(
  roots: readonly string[],
  include: (path: string) => boolean,
  signal?: AbortSignal,
  scope?: { packageId?: string; previous?: PackageCensus },
): Promise<string | undefined> {
  roots = roots.map(root => resolve(root));
  const previous = scope?.previous;
  const admitted = new Map(previous?.listing.packages.map(pod => [resolve(pod.directory), pod]));
  const targetKnown = previous?.listing.packages.some(pod => pod.id === scope?.packageId);
  const before = previous?.signature ? packageDiskSignatures(previous.signature, roots) : new Map<string, string>();
  const row = async (absolute: string, info: Stats, signal?: AbortSignal, prior?: unknown[]) => {
    const value = [absolute, info.mode, info.size, info.mtimeMs, info.ctimeMs, info.ino];
    const hashedAt = Date.now();
    // A hash taken inside the filesystem tick stays suspect until a later hash
    // confirms it outside that tick. Older first observations need only their stat.
    // ponytail: an older file rewritten with identical metadata (a deliberate mtime reset)
    // remains outside this witness; ordinary recent edits never depend on timestamp luck.
    if (info.isFile() && info.size <= scriptPodMemberBounds.maxFileBytes &&
      (typeof prior?.[7] === "number" ? prior[7] : hashedAt) - info.mtimeMs <= witnessTickMs)
      return [...value, createHash("sha256").update(await readFile(absolute, { signal })).digest("hex"), hashedAt];
    return prior?.length === 8 && value.every((part, index) => part === prior[index]) ? prior : value;
  };
  const walk = async (absolute: string, member: string, entries: unknown[], signal: AbortSignal, prior: ReadonlyMap<unknown, unknown[]>): Promise<void> => {
    signal.throwIfAborted();
    const info = await lstat(absolute);
    signal.throwIfAborted();
    entries.push(await row(absolute, info, signal, prior.get(absolute)));
    if (!info.isDirectory() || info.isSymbolicLink()) return;
    for (const name of (await readdir(absolute)).sort()) {
      signal.throwIfAborted();
      const path = member ? `${member}/${name}` : name;
      try { if (!include(path)) continue; } catch {}
      await walk(join(absolute, name), path, entries, signal, prior);
    }
  };
  try {
    const rootsEntries = await Promise.all(roots.map(async root => {
      const entries: unknown[] = [];
      entries.push(root);
      const started = performance.now();
      let logged = false;
      const startLog = () => {
        if (logged) return;
        logged = true;
        logPackageDiscovery(`Pod folder metadata scan start folder=${JSON.stringify(root)}`);
      };
      const slowLog = setTimeout(startLog, metadataScanSlowMs);
      let outcome = "completed";
      try {
        signal?.throwIfAborted();
        // Identity listing can settle after the request's five-second deadline (A9b).
        // Keep choose's late-publication path; per-Pod timers start only after this root IO.
        const info = await lstat(root);
        signal?.throwIfAborted();
        entries.push(await row(root, info, signal));
        if (info.isDirectory() && !info.isSymbolicLink()) {
          const names = await readdir(root);
          const children = await Promise.all(names.sort().map(async name => {
            const directory = join(root, name);
            let manifestRow: unknown[] | undefined;
            try {
              return await readPackageWork(directory, signal, async signal => {
                const entries: unknown[] = [];
                const prior = before.get(resolve(directory));
                const oldRows: unknown[][] = prior ? JSON.parse(prior) : [];
                // Every manifest is checked after arrival, even when only another Pod's
                // members are needed. An in-place id edit must still revoke unique claims.
                const manifest = join(directory, "pod.json");
                const info = await lstat(manifest);
                signal.throwIfAborted();
                const oldManifest = oldRows.find(row => row[0] === manifest);
                manifestRow = await row(manifest, info, signal, oldManifest);
                const pod = admitted.get(directory);
                // A miss retries uncaptured candidates: their old IO refusal is no evidence
                // that the requested id is absent. Known neighbours need not retry them.
                if (scope?.packageId !== undefined && prior && (pod ? pod.id !== scope.packageId : targetKnown) && JSON.stringify(oldManifest?.slice(0, 7)) === JSON.stringify(manifestRow.slice(0, 7)))
                  return [[directory, "retained", manifestRow]];
                await walk(directory, "", entries, signal, new Map(oldRows.map(row => [row[0], row])));
                return entries;
              });
            } catch (error) {
              signal?.throwIfAborted();
              if (!manifestRow && error instanceof Error && "code" in error && error.code === "ENOENT")
                return [[directory, "missing"]];
              outcome = "partial";
              // A failed Pod loses only its own witness. Successful neighbours still reuse
              // their bytes; an unknown whole-home signature used to recapture every Pod.
              return [[directory, "unavailable", String(error)], ...(manifestRow ? [manifestRow] : [])];
            }
          }));
          entries.push(...children.flat());
        }
      }
      catch (error) {
        outcome = "failed";
        signal?.throwIfAborted();
        if (error instanceof Error && "code" in error && error.code === "ENOENT") {
          outcome = "missing";
          entries.push("missing");
        } else entries.push([root, "unavailable", String(error)]);
      } finally {
        clearTimeout(slowLog);
        if (logged || outcome !== "completed" || performance.now() - started >= metadataScanSlowMs) {
          startLog();
          logPackageDiscovery(`Pod folder metadata scan end folder=${JSON.stringify(root)} durationMs=${Math.round(performance.now() - started)} outcome=${outcome}`);
        }
      }
      return entries;
    }));
    // Metadata-preserving edits need byte hashing; Google Drive timestamp behavior needs the live drive.
    return JSON.stringify(rootsEntries.flat());
  } catch {
    signal?.throwIfAborted();
    return undefined;
  }
}
