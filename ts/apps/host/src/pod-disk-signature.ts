import { lstat, readdir } from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { logPackageDiscovery } from "./pod-discovery-log.ts";
import { readPackageWork } from "./pod-capture.ts";

const metadataScanSlowMs = 500;

/** Partition the same metadata witness by immediate Pod folder, without a second disk walk. */
export function packageDiskSignatures(signature: string, roots: readonly string[]): Map<string, string> {
  const grouped = new Map<string, unknown[]>();
  const resolved = roots.map(root => resolve(root));
  const entries: unknown = JSON.parse(signature);
  if (!Array.isArray(entries)) return new Map();
  for (const entry of entries) {
    if (!Array.isArray(entry) || typeof entry[0] !== "string") continue;
    for (const root of resolved) {
      const path = relative(root, entry[0]);
      if (!path || isAbsolute(path) || path.startsWith(`..${sep}`) || path === "..") continue;
      const directory = join(root, path.split(sep)[0] ?? path);
      const members = grouped.get(directory) ?? [];
      members.push(entry);
      grouped.set(directory, members);
      break;
    }
  }
  return new Map([...grouped].map(([directory, entries]) => [directory, JSON.stringify(entries)]));
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
): Promise<string | undefined> {
  let failed = false;
  const walk = async (absolute: string, member: string, entries: unknown[], signal: AbortSignal): Promise<void> => {
    signal.throwIfAborted();
    const info = await lstat(absolute);
    signal.throwIfAborted();
    entries.push([absolute, info.mode, info.size, info.mtimeMs, info.ctimeMs, info.ino]);
    if (!info.isDirectory() || info.isSymbolicLink()) return;
    for (const name of (await readdir(absolute)).sort()) {
      signal.throwIfAborted();
      const path = member ? `${member}/${name}` : name;
      try { if (!include(path)) continue; } catch {}
      await walk(join(absolute, name), path, entries, signal);
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
        const info = await lstat(root);
        signal?.throwIfAborted();
        entries.push([root, info.mode, info.size, info.mtimeMs, info.ctimeMs, info.ino]);
        if (info.isDirectory() && !info.isSymbolicLink()) {
          const children = await Promise.all((await readdir(root)).sort().map(async name => {
            const directory = join(root, name);
            try {
              return await readPackageWork(directory, signal, async signal => {
                const entries: unknown[] = [];
                await walk(directory, "", entries, signal);
                return entries;
              });
            } catch {
              signal?.throwIfAborted();
              failed = true;
              outcome = "partial";
              return [];
            }
          }));
          entries.push(...children.flat());
        }
      }
      catch (error) {
        outcome = "failed";
        if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
        outcome = "missing";
        entries.push("missing");
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
    return failed ? undefined : JSON.stringify(rootsEntries.flat());
  } catch {
    signal?.throwIfAborted();
    return undefined;
  }
}
