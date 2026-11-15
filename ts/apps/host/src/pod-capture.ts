import { dirname, join, resolve } from "node:path";
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
const rootsKey = (roots: PodsRoots) => JSON.stringify([roots].flat().map((root) => {
  const absolute = resolve(root);
  return process.platform === "win32" ? absolute.toLowerCase() : absolute;
}));
// Discovery owns cross-home identity; capture reads fresh bytes only from its selected folder.
const censuses = new Map<string, (Pick<AdmittedPackage, "id" | "folder" | "directory" | "discoveryFailure"> & { home: string; generation?: number })[]>();
export function rememberPackageCensus(roots: PodsRoots, listing: PackageListing) {
  censuses.set(
    rootsKey(roots),
    listing.packages.map(({ id, folder, directory, discoveryFailure }) => {
      const home = dirname(resolve(directory));
      return { id, folder, directory, discoveryFailure, home,
        generation: completedCensuses.get(rootsKey(home))?.homeGeneration };
    }),
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
  if (pod && pod.generation !== completedCensuses.get(rootsKey(pod.home))?.homeGeneration)
    throw new PackageDiscoveryExceeded(pod.home, "Home generation changed; refresh the identity view");
  if (pod) requirePackageAvailable(pod);
}

type DiscoveryScan = {
  home?: HomePublication;
  authorized?: boolean;
  stop: AbortController;
  promise: Promise<PackageListing>;
  expired: boolean;
  completed: boolean;
  startedAt: number;
  completedAt: number;
  signature: string | undefined;
  observations?: Map<string, number>;
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
  // Owed (TIMER-STARVE): this wall-clock deadline also charges event-loop starvation to Pod I/O.
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
export type PackageCensus = {
  homeGeneration?: number;
  signature: string | undefined;
  listing: PackageListing;
  /** Observation order belongs to this census, alongside its bytes; it is not another cache. */
  observedAt?: ReadonlyMap<string, number>;
};
const completedCensuses = new Map<string, PackageCensus>();
type HomePublication = { generation: number; current(): boolean; changed(): void };
// Controls contain no member bytes. The census above is the only witness/snapshot store,
// keyed by physical home; root-set indexes below contain identities only.
const homeControls = new Map<string, { generation: number; failure?: string }>();
const rootViews = new Map<string, readonly string[]>();
let homeEpoch = 0;
let observationSequence = 0;

function homeListing(root: string, unavailable?: string): PackageListing {
  const key = rootsKey(root), listing = completedCensuses.get(key)?.listing;
  const failure = unavailable ?? homeControls.get(key)?.failure;
  if (!failure) return listing ?? { packages: [], unreadable: [] };
  return { packages: listing?.packages.map(pod => ({ ...pod, discoveryFailure: failure,
    diagnostics: [...pod.diagnostics, problem("PodHomeUnavailable", "pod.json", failure)], contributions: [] })) ?? [],
    unreadable: [{ folder: root, message: failure }] };
}

function publishViews() {
  for (const roots of rootViews.values()) rememberPackageCensus([...roots], {
    packages: roots.flatMap(root => homeListing(root).packages),
    unreadable: roots.flatMap(root => homeListing(root).unreadable),
  });
}

/** Each home owns its work. A response can project an unavailable home while native IO
 * remains alive; its eventual publication reprojects every view from current home states. */
export async function discoverPackageHomes(
  roots: PodsRoots,
  wait: "request" | "background",
  read: (root: string, current: () => boolean, changed: () => void, generation: number) => Promise<PackageListing>,
): Promise<PackageListing> {
  const homes = [...new Map([roots].flat().map(root => [rootsKey(root), resolve(root)])).values()];
  rootViews.set(rootsKey(homes), homes);
  const epoch = homeEpoch;
  const results = await Promise.all(homes.map(async root => {
    const key = rootsKey(root), previous = homeControls.get(key);
    const control = { generation: (previous?.generation ?? 0) + 1, failure: previous?.failure };
    homeControls.set(key, control);
    const current = () => homeEpoch === epoch && homeControls.get(key) === control;
    const unavailable = (reason: string) => {
      const latest = homeControls.get(key);
      // A pending peer is not recovery. Only a newer published witness defeats this
      // refusal; otherwise continuous arrivals could hide a permanently stalled home.
      if (homeEpoch === epoch && latest &&
        (completedCensuses.get(key)?.homeGeneration ?? 0) <= control.generation) {
        latest.failure = reason;
        publishViews();
      }
      return homeListing(root, reason);
    };
    const changed = () => {
      if (current()) control.failure = undefined;
      if (homeEpoch === epoch) publishViews();
    };
    const work = read(root, current, changed, control.generation).then(listing => {
      if (current()) { control.failure = undefined; publishViews(); }
      return listing;
    });
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      // Two existing per-Pod phases retain their budgets; publication keeps the final third.
      // This bounds the response, not the native read or its late completion.
      return await Promise.race([work, new Promise<PackageListing>(resolve => {
        timer = setTimeout(() => {
          const failure = `Home work exceeded ${packageDiscoveryTimeoutMs - packagePodWorkTimeoutMs} ms reading '${root}'`;
          resolve(unavailable(failure));
        }, packageDiscoveryTimeoutMs - packagePodWorkTimeoutMs);
      })]);
    } catch (error) {
      if (homeEpoch !== epoch) throw error;
      return unavailable(String(error));
    } finally { clearTimeout(timer); }
  }));
  if (homeEpoch !== epoch) throw new PackageDiscoveryExceeded(roots, "Discovery stopped");
  const listing = { packages: results.flatMap(result => result.packages), unreadable: results.flatMap(result => result.unreadable) };
  // Cold request readers retain W26's typed refusal and late-census recovery. Inventory
  // readers can still describe an empty healthy home beside an unavailable one.
  if (wait === "request" && !listing.packages.length && listing.unreadable.some(row => homes.includes(row.folder)))
    throw new PackageDiscoveryExceeded(roots);
  return listing;
}

function observedAt(listing: PackageListing, previous: PackageCensus | undefined, observations: ReadonlyMap<string, number> | undefined) {
  if (!observations) return previous?.observedAt;
  return new Map(listing.packages.map(pod => {
    const directory = resolve(pod.directory);
    return [directory, Math.max(previous?.observedAt?.get(directory) ?? 0, observations.get(directory) ?? 0)];
  }));
}

/** A peer may publish a failure while this scan reads. Unobserved Pods keep that newer status. */
function retainUnobserved(listing: PackageListing, previous: PackageCensus | undefined, observations: ReadonlyMap<string, number> | undefined): PackageListing {
  if (!previous || !observations) return listing;
  const latest = new Map(previous.listing.packages.map(pod => [resolve(pod.directory), pod]));
  return { ...listing, packages: listing.packages.map(pod => {
    const directory = resolve(pod.directory), known = latest.get(directory);
    return known?.id === pod.id && (!observations.has(directory) ||
      (observations.get(directory) ?? 0) < (previous.observedAt?.get(directory) ?? 0)) ? known : pod;
  }) };
}

/** Superseded reads never publish old bytes, but an unrelated Pod cannot erase their refusal.
 * A newer observation of the same Pod wins, including a successful recovery. */
function recordUnavailable(roots: PodsRoots, key: string, listing: PackageListing, observations: ReadonlyMap<string, number> | undefined) {
  const previous = completedCensuses.get(key);
  if (!previous || !observations) return;
  const failures = new Map(listing.packages.filter(pod => pod.discoveryFailure).map(pod => [resolve(pod.directory), pod]));
  if (!failures.size) return;
  let changed = false;
  const versions = new Map(previous.observedAt);
  const packages = previous.listing.packages.map(pod => {
    const directory = resolve(pod.directory), failed = failures.get(directory), version = observations.get(directory);
    if (failed?.id !== pod.id || version === undefined || version <= (previous.observedAt?.get(directory) ?? 0)) return pod;
    changed = true;
    versions.set(directory, version);
    return { ...pod, discoveryFailure: failed.discoveryFailure };
  });
  if (!changed) return;
  const marked = { ...previous.listing, packages };
  completedCensuses.set(key, { ...previous, listing: marked, observedAt: versions });
  rememberPackageCensus(roots, marked);
  publishViews();
}

/** Shutdown cancels discovery; request expiry alone leaves a recoverable scan running. */
export function stopPackageDiscovery() {
  homeEpoch++;
  for (const scan of scans) scan.stop.abort();
  for (const validation of validations) validation.abort();
  discovery.clear();
  completedCensuses.clear();
  homeControls.clear();
  rootViews.clear();
  censuses.clear();
}

export async function discoverPackages(
  roots: PodsRoots,
  read: (roots: readonly string[], signal: AbortSignal, previous?: PackageCensus, signature?: string) => Promise<PackageListing>,
  wait: "request" | "background",
  readSignature?: (signal: AbortSignal, previous?: PackageCensus) => Promise<string | undefined>,
  resolveSignature?: (signature: string, previous?: PackageCensus) => string,
  packageId?: string,
  observedDirectories?: (signature: string | undefined, previous?: PackageCensus) => ReadonlySet<string>,
  home?: HomePublication,
): Promise<PackageListing> {
  const key = rootsKey(roots);
  let selected: DiscoveryScan | undefined;
  let expired = false;
  const validation = new AbortController();
  validations.add(validation);
  const choose = (signature: string | undefined) => {
    validation.signal.throwIfAborted();
    const cached = completedCensuses.get(key);
    const version = ++observationSequence;
    const observed = observedDirectories?.(signature, cached);
    const observations = observed && new Map([...observed].map(directory => [directory, version]));
    if (signature !== undefined && resolveSignature)
      signature = resolveSignature(signature, cached);
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
    const retryMiss = cached?.listing.unreadable.length && (wait === "background" ||
      (packageId !== undefined && !cached.listing.packages.some(pod => pod.id === packageId)));
    if (!retryMiss && signature !== undefined && cached?.signature === signature &&
      !cached.listing.packages.some(pod => pod.discoveryFailure && (packageId === undefined || pod.id === packageId))) {
      if ((!home || home.current()) && observations) completedCensuses.set(key, { ...cached,
        homeGeneration: home?.generation, observedAt: observedAt(cached.listing, cached, observations) });
      return Promise.resolve(cached.listing);
    }
    if (scan) {
      // Matching post-arrival witnesses can share work, including its publication authority.
      if (home?.current()) { scan.home = home; scan.authorized = true; }
      selected = scan;
      if (observations) {
        scan.observations ??= new Map();
        for (const [directory, version] of observations) scan.observations.set(directory, version);
      }
      if (scan.completed) {
        discovery.delete(key); // A late answer serves at most one reader.
        if (home?.current()) {
          const finished = scan;
          return finished.promise.then(listing => {
            validation.signal.throwIfAborted();
            if (home.current()) {
              const latest = completedCensuses.get(key);
              const published = retainUnobserved(listing, latest, finished.observations);
              completedCensuses.set(key, { signature: finished.expired ? undefined : signature,
                homeGeneration: home.generation,
                listing: published, observedAt: observedAt(published, latest, finished.observations) });
              rememberPackageCensus(roots, published);
              home.changed();
              return published;
            }
            return listing;
          });
        }
      }
      return scan.promise;
    }
    const stop = new AbortController();
    const current: DiscoveryScan = {
      home,
      authorized: !home || home.current(),
      stop,
      promise: read([roots].flat(), stop.signal, cached, signature),
      expired,
      completed: false,
      startedAt: Date.now(),
      completedAt: 0,
      signature,
      observations,
    };
    current.promise = current.promise.then(listing => {
      stop.signal.throwIfAborted();
      if (current.observations) {
        const before = new Map(cached?.listing.packages.map(pod => [resolve(pod.directory), pod.discoveryFailure]));
        for (const pod of listing.packages) {
          const directory = resolve(pod.directory);
          if (pod.discoveryFailure && pod.discoveryFailure !== before.get(directory) && !current.observations.has(directory))
            current.observations.set(directory, version);
        }
      }
      const latest = completedCensuses.get(key);
      const publishing = discovery.get(key) === current && (!current.home || current.home.current());
      const published = publishing ? retainUnobserved(listing, latest, current.observations) : listing;
      if (publishing) rememberPackageCensus(roots, published);
      current.completed = true;
      current.completedAt = Date.now();
      // A late home snapshot is retained without a reusable witness. Its existing scan
      // keeps the one-reader 5 s window; a later reader must validate/capture afresh.
      if (publishing && (!current.expired || current.home)) {
        // Unknown metadata cannot authorize byte reuse, but it must retain identity and retry
        // markers across repeated IO failures instead of turning the second retry into absence.
        completedCensuses.set(key, { signature: current.expired ? undefined : signature,
          homeGeneration: current.home?.generation, listing: published, observedAt: observedAt(published, latest, current.observations) });
        if (!current.expired) discovery.delete(key);
        current.home?.changed();
      }
      // A superseded capture can still report a valid Pod failure, but a root observation
      // that was already obsolete when selected cannot overwrite newer home knowledge.
      if (current.authorized) recordUnavailable(roots, key, listing, current.observations);
      return published;
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
  const work = readSignature ? readSignature(validation.signal, completedCensuses.get(key)).then(choose) : choose(undefined);
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
  discover: (roots: PodsRoots) => Promise<PackageListing>,
): Promise<AdmittedPackage> {
  // Do not resolve homes here: synchronous Drive probing runs outside any async deadline.
  const selectedRoots = roots ?? productRoots;
  if (!selectedRoots || !censuses.has(rootsKey(selectedRoots)))
    throw Error(
      `Pod '${id}' cannot be captured before Pod discovery finishes. Refresh the Pod list and try again.`,
    );
  // Known keys need the same fresh identity check as misses. Freeze that census's
  // selected bytes instead of recapturing an indexed folder after the check.
  const found = (await discover(selectedRoots)).packages.filter(pod => pod.id === id);
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
  return selected;
}
