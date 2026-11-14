import { join, resolve } from "node:path";
import { createHash } from "node:crypto";
import { lstat, open, readdir } from "node:fs/promises";
import { message } from "@pe/agent-contracts";
import { scriptPodMemberBounds as memberBounds } from "@pe/host-contracts/generated";
import type { MemberIssue } from "@pe/host-contracts/operation-types";
import type { AdmittedPackage, PackageListing, PackageMember, PodsRoots } from "./packages.ts";

export class PackageReadIncomplete extends Error {}
export const incompletePackageRead = (error: unknown) => error instanceof PackageReadIncomplete ||
  (error instanceof Error && "code" in error && typeof error.code === "string");

export const packageProblem = (code: string, path: string, message: string): MemberIssue => ({
  code,
  path,
  message,
  severity: "error",
});
const problem = packageProblem;

export async function capturePodDirectory(
  directory: string,
  isPackageMember: (path: string) => boolean,
  manifestOnly = false,
  signal?: AbortSignal,
): Promise<{ members: PackageMember[]; diagnostics: MemberIssue[] }> {
  const members: PackageMember[] = [];
  const diagnostics: MemberIssue[] = [];
  const names = new Set<string>();
  let directories = 0,
    files = 0,
    total = 0;
  const walk = async (relative: string): Promise<void> => {
    signal?.throwIfAborted();
    if (++directories > memberBounds.maxDirectoryCount) throw Error("Pod directory limit exceeded");
    const absolute = join(directory, relative);
    if ((await lstat(absolute)).isSymbolicLink()) throw Error("Pod directories cannot be links");
    signal?.throwIfAborted();
    for (const entry of (await readdir(absolute, { withFileTypes: true })).sort((a, b) =>
      a.name.localeCompare(b.name),
    )) {
      signal?.throwIfAborted();
      const path = relative ? `${relative}/${entry.name}` : entry.name;
      if (manifestOnly && path !== "pod.json") continue;
      try {
        if (!isPackageMember(path)) continue;
        if (names.has(path.toLowerCase())) throw Error("Case-colliding package path");
        names.add(path.toLowerCase());
        if (entry.isSymbolicLink()) throw Error("Pod input cannot follow links");
        if (entry.isDirectory()) {
          await walk(path);
          continue;
        }
        if (++files > memberBounds.maxFileCount) throw Error("Pod file count limit exceeded");
        const info = await lstat(join(directory, path));
        signal?.throwIfAborted();
        if (!info.isFile() || info.isSymbolicLink())
          throw Error("Pod input must be a regular file");
        if (info.size > memberBounds.maxFileBytes)
          throw Error(`Pod member exceeds ${memberBounds.maxFileBytes} bytes`);
        if ((total += info.size) > memberBounds.maxTotalBytes)
          throw Error(`Pod members exceed ${memberBounds.maxTotalBytes} total bytes`);
        const handle = await open(join(directory, path), "r");
        let bytes: Buffer;
        try {
          signal?.throwIfAborted(); // A late open still closes its handle before abandoning capture.
          const stat = await handle.stat();
          signal?.throwIfAborted();
          if (!stat.isFile() || stat.ino !== info.ino || stat.size !== info.size)
            throw new PackageReadIncomplete("Pod input changed during capture");
          bytes = Buffer.alloc(stat.size + 1);
          let count = 0;
          while (count < bytes.length) {
            signal?.throwIfAborted();
            const read = await handle.read(bytes, count, bytes.length - count, null);
            signal?.throwIfAborted();
            if (!read.bytesRead) break;
            count += read.bytesRead;
          }
          bytes = bytes.subarray(0, count);
        } finally {
          await handle.close();
        }
        if (bytes.length !== info.size) throw new PackageReadIncomplete("Pod input changed during capture");
        let schema: string | null = null;
        if (path.endsWith(".json")) {
          try {
            const value = JSON.parse(bytes.toString("utf8").replace(/^\uFEFF/, ""));
            schema = typeof value?.$schema === "string" ? value.$schema : null;
          } catch {
            diagnostics.push({
              ...problem("JsonParseError", path, "Member is not valid JSON."),
              severity: "warning",
            });
          }
        }
        members.push({
          path,
          bytes,
          sha256: createHash("sha256").update(bytes).digest("hex"),
          schema,
        });
      } catch (error) {
        signal?.throwIfAborted();
        if (incompletePackageRead(error)) throw error;
        diagnostics.push(problem("PackageMemberInvalid", path, message(error)));
      }
      if (
        files > memberBounds.maxFileCount ||
        directories > memberBounds.maxDirectoryCount ||
        total > memberBounds.maxTotalBytes
      )
        return;
    }
  };
  await walk("");
  return { members, diagnostics };
}

let productRoots: PodsRoots | undefined;
export const rememberCaptureRoots = (roots: PodsRoots) => {
  productRoots = roots;
};
const rootsKey = (roots: PodsRoots) => JSON.stringify([roots].flat().map((root) => resolve(root)));
// Discovery owns cross-home identity; capture reads fresh bytes only from its selected folder.
const censuses = new Map<string, Pick<AdmittedPackage, "id" | "folder" | "directory" | "discoveryFailure">[]>();
export function rememberPackageCensus(roots: PodsRoots, listing: PackageListing) {
  censuses.set(
    rootsKey(roots),
    listing.packages.map(({ id, folder, directory, discoveryFailure }) => ({ id, folder, directory, discoveryFailure })),
  );
}

export const packageDiscoveryTimeoutMs = 5_000;
// Parallel metadata and capture each get one third; root discovery and publication keep the rest.
export const packagePodWorkTimeoutMs = Math.floor(packageDiscoveryTimeoutMs / 3);
export const packageScanMaxAgeMs = 60_000;

export class PackageDiscoveryExceeded extends Error {
  readonly code = "pod.discovery.exceeded";
  constructor(roots: PodsRoots, incomplete?: string) {
    super(incomplete
      ? `Pod discovery could not complete listing ${[roots].flat().join(", ")}: ${incomplete}. Try again when the folder is available.`
      : `Pod discovery exceeded ${packageDiscoveryTimeoutMs} ms listing ${[roots].flat().join(", ")}. Try again when the folder is available.`);
  }
}

/** One availability boundary for indexed captures, admitted bytes, Pages and by-key reads. */
export function requirePackageAvailable(pod: Pick<AdmittedPackage, "directory" | "discoveryFailure">) {
  if (pod.discoveryFailure) throw new PackageDiscoveryExceeded(pod.directory, pod.discoveryFailure);
}

export function requireIndexedPackageAvailable(id: string, roots: PodsRoots | undefined = productRoots) {
  const pod = roots && censuses.get(rootsKey(roots))?.find(pod => pod.id === id);
  if (pod) requirePackageAvailable(pod);
}

type DiscoveryScan = {
  stop: AbortController;
  promise: Promise<PackageListing>;
  expired: boolean;
  completed: boolean;
  startedAt: number;
  completedAt: number;
  signature: string | undefined;
};
const discovery = new Map<string, DiscoveryScan>();
const scans = new Set<DiscoveryScan>();
const validations = new Set<AbortController>();

/** Bound one Pod, not its neighbours. Native IO may settle late; its signal forbids publication. */
export async function readPackageWork<T>(
  directory: string,
  parent: AbortSignal | undefined,
  read: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const stop = new AbortController();
  validations.add(stop);
  const cancel = () => stop.abort(parent?.reason);
  parent?.addEventListener("abort", cancel, { once: true });
  if (parent?.aborted) cancel();
  let rejectAborted = () => {};
  const aborted = new Promise<never>((_, reject) => {
    rejectAborted = () => reject(stop.signal.reason);
    stop.signal.addEventListener("abort", rejectAborted, { once: true });
    if (stop.signal.aborted) rejectAborted();
  });
  const timer = setTimeout(() => stop.abort(new PackageReadIncomplete(
    `Pod work exceeded ${packagePodWorkTimeoutMs} ms reading '${directory}'`,
  )), packagePodWorkTimeoutMs);
  try {
    return await Promise.race([Promise.resolve().then(() => {
      stop.signal.throwIfAborted();
      return read(stop.signal);
    }), aborted]);
  } finally {
    clearTimeout(timer);
    parent?.removeEventListener("abort", cancel);
    stop.signal.removeEventListener("abort", rejectAborted);
    validations.delete(stop);
  }
}
export type PackageCensus = { signature: string | undefined; listing: PackageListing };
const completedCensuses = new Map<string, PackageCensus>();

/** Shutdown cancels discovery; request expiry alone leaves a recoverable scan running. */
export function stopPackageDiscovery() {
  for (const scan of scans) scan.stop.abort();
  for (const validation of validations) validation.abort();
  discovery.clear();
  completedCensuses.clear();
}

export async function discoverPackages(
  roots: PodsRoots,
  read: (roots: readonly string[], signal: AbortSignal, previous?: PackageCensus, signature?: string) => Promise<PackageListing>,
  wait: "request" | "background",
  readSignature?: (signal: AbortSignal) => Promise<string | undefined>,
): Promise<PackageListing> {
  const key = rootsKey(roots);
  let selected: DiscoveryScan | undefined;
  let expired = false;
  const validation = new AbortController();
  validations.add(validation);
  const choose = (signature: string | undefined) => {
    validation.signal.throwIfAborted();
    let scan = discovery.get(key);
    const tooOld = scan && !scan.completed && Date.now() - scan.startedAt >= packageScanMaxAgeMs;
    // Validate joins and late answers too. Unknown metadata never authorizes reuse.
    const changed = scan && readSignature && (signature === undefined || scan.signature !== signature);
    if (scan && (tooOld || changed ||
      (scan.completed && (wait === "background" || Date.now() - scan.completedAt >= packageDiscoveryTimeoutMs)))) {
      // Superseding a read leaves its waiters running. Only age and shutdown cancel IO.
      if (tooOld) scan.stop.abort();
      discovery.delete(key);
      scan = undefined;
    }
    if (scan) {
      selected = scan;
      if (scan.completed) discovery.delete(key); // A late answer serves at most one reader.
      return scan.promise;
    }
    const cached = completedCensuses.get(key);
    if (signature !== undefined && cached?.signature === signature &&
      !cached.listing.packages.some(pod => pod.discoveryFailure)) return Promise.resolve(cached.listing);
    const stop = new AbortController();
    const current: DiscoveryScan = {
      stop,
      promise: read([roots].flat(), stop.signal, cached, signature),
      expired,
      completed: false,
      startedAt: Date.now(),
      completedAt: 0,
      signature,
    };
    current.promise = current.promise.then(listing => {
      stop.signal.throwIfAborted();
      if (discovery.get(key) === current) rememberPackageCensus(roots, listing);
      current.completed = true;
      current.completedAt = Date.now();
      // Only on-time answers enter the checked cache. Late answers keep their one-reader 5 s window.
      if (!current.expired && discovery.get(key) === current) {
        // Unknown metadata cannot authorize byte reuse, but it must retain identity and retry
        // markers across repeated IO failures instead of turning the second retry into absence.
        completedCensuses.set(key, { signature, listing });
        discovery.delete(key);
      }
      return listing;
    }, error => {
      if (discovery.get(key) === current) discovery.delete(key);
      throw error;
    }).finally(() => scans.delete(current));
    discovery.set(key, current);
    scans.add(current);
    selected = current;
    return current.promise;
  };
  // The metadata walk is inside the request budget and starts after this call's arrival.
  const work = readSignature ? readSignature(validation.signal).then(choose) : choose(undefined);
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    if (wait === "background") return await work;
    return await Promise.race([
      work,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          expired = true;
          if (selected) selected.expired = true;
          reject(new PackageDiscoveryExceeded(roots));
        }, packageDiscoveryTimeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timer);
    // A timed-out metadata read must not start an untracked scan after shutdown.
    void work.finally(() => validations.delete(validation)).catch(() => {});
  }
}

export async function captureIndexedPackage(
  id: string,
  roots: PodsRoots | undefined,
  read: (directory: string, folder: string, signal: AbortSignal) => Promise<AdmittedPackage>,
): Promise<AdmittedPackage> {
  // Do not resolve homes here: synchronous Drive probing runs outside any async deadline.
  const selectedRoots = roots ?? productRoots;
  const census = selectedRoots && censuses.get(rootsKey(selectedRoots));
  if (!census)
    throw Error(
      `Pod '${id}' cannot be captured before Pod discovery finishes. Refresh the Pod list and try again.`,
    );
  const found = census.filter((pod) => pod.id === id);
  if (found.length > 1)
    throw Error(
      `Pod id '${id}' is claimed by ${found.map((pod) => pod.directory).join(" and ")}: none is used until the id is unique.`,
    );
  const selected = found[0];
  if (!selected)
    throw Error(
      `No discovered Pod has id '${id}'. Refresh the Pod list after adding or moving a Pod.`,
    );
  requirePackageAvailable(selected);
  const pod = await readPackageWork(selected.directory, undefined,
    signal => read(selected.directory, selected.folder, signal)).catch((error: unknown) => {
      if (incompletePackageRead(error)) throw new PackageDiscoveryExceeded(selected.directory, message(error));
      throw error;
    });
  if (pod.id !== id)
    throw Error(
      `Pod identity changed in '${selected.directory}'. Refresh the Pod list and try again.`,
    );
  return pod;
}
