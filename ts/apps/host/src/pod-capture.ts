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
  constructor(roots: PodsRoots) {
    super(`Pod discovery exceeded ${packageDiscoveryTimeoutMs} ms listing ${[roots].flat().join(", ")}. Try again when the folder is available.`);
  }
}

const discovery = new Map<string, {
  stop: AbortController;
  promise: Promise<PackageListing>;
  expired: boolean;
  completed: boolean;
  startedAt: number;
  completedAt: number;
}>();

/** Shutdown cancels discovery; request expiry alone leaves a recoverable scan running. */
export function stopPackageDiscovery() {
  for (const scan of discovery.values()) scan.stop.abort();
  discovery.clear();
}

export async function discoverPackages(
  roots: PodsRoots,
  read: (roots: readonly string[], signal: AbortSignal) => Promise<PackageListing>,
  wait: "request" | "background",
): Promise<PackageListing> {
  const key = rootsKey(roots);
  let scan = discovery.get(key);
  if (scan && (scan.completed
    ? wait === "background" || Date.now() - scan.completedAt >= packageDiscoveryTimeoutMs
    : Date.now() - scan.startedAt >= packageScanMaxAgeMs)) {
    scan.stop.abort();
    discovery.delete(key);
    scan = undefined;
  }
  if (!scan) {
    const stop = new AbortController();
    const current = {
      stop,
      promise: read([roots].flat(), stop.signal),
      expired: false,
      completed: false,
      startedAt: Date.now(),
      completedAt: 0,
    };
    current.promise = current.promise.then(listing => {
      stop.signal.throwIfAborted();
      rememberPackageCensus(roots, listing);
      current.completed = true;
      current.completedAt = Date.now();
      // One request may consume a late answer within 5 s; lifecycle metadata requires a fresh scan.
      if (!current.expired && discovery.get(key) === current) discovery.delete(key);
      return listing;
    }, error => {
      if (discovery.get(key) === current) discovery.delete(key);
      throw error;
    });
    discovery.set(key, current);
    scan = current;
  } else if (scan.completed) {
    discovery.delete(key);
  }
  if (wait === "background") return scan.promise;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      scan.promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          scan.expired = true;
          reject(new PackageDiscoveryExceeded(roots));
        }, packageDiscoveryTimeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timer);
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
