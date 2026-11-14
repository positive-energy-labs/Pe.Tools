import { resolve } from "node:path";
import type { AdmittedPackage, PackageListing, PodsRoots } from "./packages.ts";

let productRoots: PodsRoots | undefined;
export const rememberCaptureRoots = (roots: PodsRoots) => {
  productRoots = roots;
};
const rootsKey = (roots: PodsRoots) => JSON.stringify([roots].flat().map((root) => resolve(root)));
// Discovery owns cross-home identity; capture reads fresh bytes only from its selected folder.
const censuses = new Map<string, Pick<AdmittedPackage, "id" | "folder" | "directory">[]>();
export function rememberPackageCensus(roots: PodsRoots, listing: PackageListing) {
  censuses.set(
    rootsKey(roots),
    listing.packages.map(({ id, folder, directory }) => ({ id, folder, directory })),
  );
}

export const packageDiscoveryTimeoutMs = 5_000;
export const packageScanMaxAgeMs = 60_000;

export class PackageDiscoveryExceeded extends Error {
  readonly code = "pod.discovery.exceeded";
  constructor(roots: PodsRoots, incomplete?: string) {
    super(incomplete
      ? `Pod discovery could not complete listing ${[roots].flat().join(", ")}: ${incomplete}. Try again when the folder is available.`
      : `Pod discovery exceeded ${packageDiscoveryTimeoutMs} ms listing ${[roots].flat().join(", ")}. Try again when the folder is available.`);
  }
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
export type PackageCensus = { signature: string; listing: PackageListing };
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
    if (signature !== undefined && cached?.signature === signature) return Promise.resolve(cached.listing);
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
        if (signature !== undefined) completedCensuses.set(key, { signature, listing });
        else completedCensuses.delete(key);
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
  const stop = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const pod = await Promise.race([
      read(selected.directory, selected.folder, stop.signal),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          stop.abort();
          reject(
            Error(
              `Pod '${id}' capture exceeded 5000 ms reading '${selected.directory}'. Try again when this folder is available.`,
            ),
          );
        }, 5_000);
      }),
    ]);
    if (pod.id !== id)
      throw Error(
        `Pod identity changed in '${selected.directory}'. Refresh the Pod list and try again.`,
      );
    return pod;
  } finally {
    clearTimeout(timer);
  }
}
