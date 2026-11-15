import {
  message,
  contributionKey,
  packageIdSchema,
  packageMemberPathSchema,
  type ContributionKind,
  scriptModeSchema,
  type ScriptMode,
} from "@pe/agent-contracts";
import type { Dirent } from "node:fs";
import { lstat, readdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import type { ScriptingExecute } from "@pe/host-contracts/generated";
import type { MemberIssue } from "@pe/host-contracts/operation-types";
import { productPathNames } from "@pe/host-contracts/contracts";
import { isCompilerSource, isCompilerInput } from "@pe/host-contracts/script-revision";
export { isCompilerSource, isCompilerInput } from "@pe/host-contracts/script-revision";
import { contentHomes, contentRootsReady, ContentHomeUnavailable } from "./content-roots.ts";
import { shippedPodUpdateRefusals } from "./shipped-pod-status.ts";
import { podModelSchema, type PodModel } from "./pod-model.ts";
import { logPackageDiscovery as scanLog } from "./pod-discovery-log.ts";
import { observedPackageDirectories, packageDiskFailure, packageDiskFiles, packageDiskSignatures, podsDiskSignature, resolvePackageDiskSignature } from "./pod-disk-signature.ts";
export { bindPackageScanLogger, logPackageDiscovery, packageScanLog, packageScanLogLineLimit } from "./pod-discovery-log.ts";
import {
  captureIndexedPackage,
  rememberCaptureRoots,
  discoverPackages,
  discoverPackageHomes,
  type PackageCensus,
  requirePackageAvailable,
  requireKnownPackageIdentity,
  capturePodDirectory,
  incompletePackageRead,
  PackageReadIncomplete,
  PackageDiscoveryExceeded,
  packageProblem as problem,
  readPackageWork,
} from "./pod-capture.ts";

export type PackageEntrypoint = {
  sourcePath: string;
  name: string | null;
  description: string | null;
  /** Declared, it is every door's default, and `ReadOnly` refuses a write mode (contract C1). */
  mode: ScriptMode | null;
};
export type PackageMember = {
  path: string;
  sha256: string;
  bytes: Uint8Array;
  schema: string | null;
};
export type PackageContribution = {
  kind: ContributionKind;
  path: string;
  memberPath: string;
  key: string;
  name: string;
  description: string | null;
  mode?: ScriptMode;
};
export type AdmittedPackage = {
  /** Last known admission for discovery only; byte-serving boundaries refuse until recovery. */
  discoveryFailure?: string;
  for?: PodModel;
  id: string;
  name: string;
  version: string;
  folder: string;
  directory: string;
  entrypoints: PackageEntrypoint[];
  members: PackageMember[];
  diagnostics: MemberIssue[];
  contributions: PackageContribution[];
};
export type PackageListing = {
  packages: AdmittedPackage[];
  unreadable: { folder: string; message: string }[];
  homeGenerations?: ReadonlyMap<string, number | undefined>;
  unknownHomes?: readonly string[];
};
export type CapturedPackage = AdmittedPackage & {
  sourceBundle: ScriptingExecute.Req.ScriptPodSourceBundle;
  memberBundle: ScriptingExecute.Req.ScriptPodSourceBundle;
};

// One exclusion policy for authored input. Page state lives under the machine state root (homes
// freeze shape 7), so a `.state` folder inside a pod is debris, never a portable member.
const debris = new Set([
  ".state",
  "output",
  "bin",
  "obj",
  "node_modules",
  ".git",
  ".vs",
  ".idea",
  ".cache",
  "cache",
  "dist",
  ".artifacts",
]);
export function isPackageMember(path: string): boolean {
  const parts = packageMemberPathSchema.parse(path).toLowerCase().split("/");
  return (
    !parts.some((part) => debris.has(part)) &&
    !parts.some((part) => part === ".env" || part.startsWith(".env.") || part === "context.token")
  );
}
/** Kind follows the admitted path; declaration exposes a script but does not authorize it. */
export function kindOfMember(
  path: string,
  entrypoints: readonly Pick<PackageEntrypoint, "sourcePath">[] = [],
): PackageContribution["kind"] | undefined {
  if (/^pages\/[^/]+\/index\.html$/.test(path)) return "page";
  if (/^skills\/[^/]+\/SKILL\.md$/.test(path)) return "skill";
  if (entrypoints.some((entry) => entry.sourcePath === path)) return "script";
  if (path !== "pod.json" && path.toLowerCase().endsWith(".json")) return "member";
  return undefined;
}

/** The home a pod's folder sits in, by its tier and folder; undefined for a folder outside every home. */
export const podHome = (directory: string, pointer?: string | null) => {
  const home = contentHomes(pointer).find(
    (one) => resolve(dirname(directory)) === resolve(one.root, productPathNames.podsDirectoryName),
  );
  return home && { tier: home.tier, path: home.root };
};

/**
 * One Pods folder, or the product's Pods in every home, in list order (user, project, firm). The
 * project home is the one the target document's pointer names, so a call that targets no document
 * has none.
 */
export type PodsRoots = string | readonly string[];
export const productPodsRoots = (pointer?: string | null) => {
  const roots = contentHomes(pointer).map(home => join(home.root, productPathNames.podsDirectoryName));
  if (!pointer) rememberCaptureRoots(roots);
  return roots;
};
/** The Pods folder of the project home a target document's pointer names; null when it names none here. */
export const projectPodsRoot = (pointer: string | null | undefined) => {
  const home = contentHomes(pointer).find(home => home.tier === "project")?.root;
  return home && join(home, productPathNames.podsDirectoryName);
};

/** One notice for an id claimed twice: it names every claiming folder by its full path. */
const claimedTwice = (id: string, twins: readonly Pick<AdmittedPackage, "directory">[]) =>
  `Pod id '${id}' is claimed by ${twins.map((twin) => twin.directory).join(" and ")}: none is used until the id is unique.`;


/**
 * Read once per snapshot. Hashes, projection, and capture all refer to these exact bytes. A pod id
 * is unique across homes (ADR 0037 rule 4): an id claimed twice, in one Pods folder or in two
 * homes, is refused in every copy. Nothing shadows.
 */
export type PackageDiscoveryOptions = {
  podsRoots?: PodsRoots;
  wait?: "request" | "background";
  /** Fresh members for this id, plus fresh manifest metadata for every identity claim.
   * Other Pods retain their last census bytes until used or explicitly refreshed. */
  packageId?: string;
};
export async function listPackages({ podsRoots, wait = "request", packageId }: PackageDiscoveryOptions = {}): Promise<PackageListing> {
  if (podsRoots === undefined) {
    await contentRootsReady();
    if (!contentHomes().some(home => home.tier === "user")) throw new ContentHomeUnavailable();
    podsRoots = productPodsRoots();
  }
  const listing = await discoverPackageHomes(podsRoots, wait, (root, current, changed, generation) => discoverPackages(root, scanPackages, wait,
    (signal, previous) => podsDiskSignature([root], isPackageMember, signal,
      { packageId, previous }),
    (signature, previous) => resolvePackageDiskSignature(signature, previous, [root]), packageId,
    (signature, previous) => observedPackageDirectories(signature, [root], previous), { current, changed, generation }), packageId);
  // Import notices are runtime state, not disk bytes; project them even when the census is reused.
  return { ...listing, packages: listing.packages.map(pod => {
    const twins = listing.packages.filter(other => other.id === pod.id);
    const diagnostics = currentDiagnostics(pod.id, pod.diagnostics);
    if (twins.length > 1) diagnostics.unshift(problem("DuplicatePodId", "pod.json", claimedTwice(pod.id, twins)));
    return { ...pod, diagnostics, contributions: twins.length > 1 ? [] : pod.contributions };
  }) };
}

function currentDiagnostics(id: string, issues: readonly MemberIssue[]): MemberIssue[] {
  const diagnostics = issues.filter(issue => issue.code !== "ShippedExampleUpdateKept");
  const updateRefusal = shippedPodUpdateRefusals.get(id);
  if (updateRefusal) diagnostics.push({ code: "ShippedExampleUpdateKept", path: "pod.json", message: updateRefusal, severity: "warning" });
  return diagnostics;
}

async function scanPackages(
  roots: readonly string[],
  signal: AbortSignal,
  previous?: PackageCensus,
  signature?: string,
): Promise<PackageListing> {
  // The census owns reuse. Unknown metadata never permits borrowing bytes, and duplicate identity
  // is projected after reuse so a temporary collision cannot poison an unchanged Pod.
  const before = previous?.signature === undefined ? undefined : packageDiskSignatures(previous.signature, roots);
  const after = signature && packageDiskSignatures(signature, roots);
  const reusable = new Map(previous?.listing.packages
    .filter(pod => !pod.discoveryFailure && after && before?.has(resolve(pod.directory)) &&
      before.get(resolve(pod.directory)) === after.get(resolve(pod.directory)))
    .map(pod => [resolve(pod.directory), pod]));
  const admitted = new Map(previous?.listing.packages.map(pod => [resolve(pod.directory), pod]));
  const result: PackageListing = { packages: [], unreadable: [] };
  const listings = await Promise.all(roots.map(async root => {
    signal.throwIfAborted();
    const failure = packageDiskFailure(signature, root);
    if (failure) {
      const known = [...admitted.values()].filter(pod => resolve(dirname(pod.directory)) === resolve(root));
      if (!known.length) throw new PackageDiscoveryExceeded(root, failure);
      return { packages: known.map(pod => unavailablePackage(pod, failure)), unreadable: [] };
    }
    const started = performance.now();
    scanLog(`Pod folder scan start folder=${JSON.stringify(root)}`);
    let outcome = "failed";
    let ended = false;
    const end = () => {
      if (ended) return;
      ended = true;
      scanLog(
        `Pod folder scan end folder=${JSON.stringify(root)} durationMs=${Math.round(performance.now() - started)} outcome=${signal.aborted ? "aborted" : outcome}`,
      );
    };
    signal.addEventListener("abort", end, { once: true });
    let listing: PackageListing;
    try {
      listing = await listPodsFolder(root, signal, reusable, admitted, after || new Map());
      signal.throwIfAborted();
      outcome = "completed";
    } finally {
      end();
      signal.removeEventListener("abort", end);
    }
    return listing;
  }));
  for (const listing of listings) {
    result.packages.push(...listing.packages);
    result.unreadable.push(...listing.unreadable);
  }
  return result;
}

async function listPodsFolder(podsRoot: string, signal: AbortSignal, reusable: ReadonlyMap<string, AdmittedPackage>, admitted: ReadonlyMap<string, AdmittedPackage>, signatures: ReadonlyMap<string, string>): Promise<PackageListing> {
  const result: PackageListing = { packages: [], unreadable: [] };
  let entries;
  try {
    entries = await readdir(podsRoot, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return result;
    const previous = [...admitted.values()].filter(pod => resolve(dirname(pod.directory)) === resolve(podsRoot));
    if (previous.length) return { packages: previous.map(pod => unavailablePackage(pod, error)), unreadable: [] };
    throw error;
  }
  const nameKey = (name: string) => process.platform === "win32" ? name.toLowerCase() : name;
  const present = new Set(entries.map(entry => nameKey(entry.name)));
  // An omitted entry can be a partial Drive listing. Require an actual absence before
  // withdrawing an admission; a readable or stalled manifest keeps only this Pod unavailable.
  const missing = [...admitted.values()].filter(pod =>
    resolve(dirname(pod.directory)) === resolve(podsRoot) && !present.has(nameKey(pod.folder)))
    .map(async pod => {
      try {
        await readPackageWork(pod.directory, signal, async signal => {
          await lstat(join(pod.directory, "pod.json"));
          signal.throwIfAborted();
          throw new PackageReadIncomplete(`Pod folder listing omitted '${pod.directory}'`);
        });
      } catch (error) {
        signal.throwIfAborted();
        if (error instanceof Error && "code" in error && error.code === "ENOENT")
          return { packages: [], unreadable: [] };
        return { packages: [unavailablePackage(pod, error)], unreadable: [] };
      }
      return { packages: [], unreadable: [] };
    });
  const listings = await Promise.all(entries.sort((a, b) => a.name.localeCompare(b.name)).map(async entry => {
    signal.throwIfAborted();
    const result: PackageListing = { packages: [], unreadable: [] };
    if (!entry.isDirectory() && !entry.isSymbolicLink()) return result;
    const directory = join(podsRoot, entry.name);
    try {
      const failure = packageDiskFailure(signatures.get(resolve(directory)), directory);
      if (failure) throw new PackageReadIncomplete(failure);
      const pod = await readPackageWork(directory, signal, async signal => {
        if (entry.isSymbolicLink()) throw Error("Pod folders cannot be links.");
        try {
          await lstat(join(directory, "pod.json"));
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
          throw error;
        }
        const pod = reusable.get(resolve(directory)) ?? await readPackageDirectory(directory, entry.name, signal);
        const signature = signatures.get(resolve(directory));
        if (!reusable.has(resolve(directory)) && signature && !pod.diagnostics.some(issue => issue.code === "PackageMemberInvalid")) {
          const captured = new Set(pod.members.map(member => resolve(directory, member.path)));
          const expected = packageDiskFiles(signature);
          if (captured.size !== expected.length || expected.some(path => !captured.has(resolve(path))))
            throw new PackageReadIncomplete("Pod members changed during capture");
        }
        return pod;
      });
      if (pod) result.packages.push(pod);
    } catch (error) {
      signal.throwIfAborted();
      const previous = admitted.get(resolve(directory));
      if (previous && incompletePackageRead(error)) {
        result.packages.push(unavailablePackage(previous, error));
        return result;
      }
      result.unreadable.push({ folder: entry.name, message: message(error) });
    }
    return result;
  }).concat(missing));
  for (const listing of listings) {
    result.packages.push(...listing.packages);
    result.unreadable.push(...listing.unreadable);
  }
  return result;
}

const unavailablePackage = (pod: AdmittedPackage, error: unknown): AdmittedPackage => ({
  ...pod, discoveryFailure: message(error),
});

/** The one admitted package with this id (manifest identity, never a folder alias); a twice-claimed or missing id refuses with its reason. */
export function onePackage(
  listing: PackageListing,
  id: string,
  refuse = (reason: string, _status: 404 | 409): Error => Error(reason),
): AdmittedPackage {
  const found = listing.packages.filter((pod) => pod.id === id);
  if (found.length === 1) {
    const selected = found[0]!;
    requirePackageAvailable(selected);
    return selected;
  }
  if (!found.length) requireKnownPackageIdentity(listing);
  throw found.length
    ? refuse(claimedTwice(id, found), 409)
    : refuse(`No installed pod has id '${id}'.`, 404);
}

export const readPackage = async (id: string, options: Pick<PackageDiscoveryOptions, "podsRoots"> = {}) =>
  onePackage(await listPackages({ ...options, packageId: id }), id);

/** Freeze admitted bytes, or a fresh scoped census for a key. Member semantics stay native. */
export async function capturePackage(
  packageOrId: AdmittedPackage | string,
  podsRoots?: PodsRoots,
): Promise<CapturedPackage> {
  const pod =
    typeof packageOrId === "string"
      ? await captureIndexedPackage(packageOrId, podsRoots,
        roots => listPackages({ podsRoots: roots, packageId: packageOrId }))
      : packageOrId;
  requirePackageAvailable(pod);
  const errors = pod.diagnostics.filter((issue) =>
    ["PackageMemberInvalid", "DuplicatePodId"].includes(issue.code),
  );
  if (errors.length)
    throw Error(errors.map((issue) => `${issue.path}: ${issue.message}`).join("; "));
  const files = pod.members.map((member) => ({
    path: member.path,
    bytesBase64: Buffer.from(member.bytes).toString("base64"),
  }));
  return {
    ...pod,
    memberBundle: { files },
    sourceBundle: { files: files.filter((file) => isCompilerInput(file.path)) },
  };
}

export const captureDirectory = (directory: string, manifestOnly = false, signal?: AbortSignal) =>
  capturePodDirectory(directory, isPackageMember, manifestOnly, signal);
/**
 * Fresh global identity claims, followed by full admission of only the selected folder. The folder
 * name and the manifest id must each be claimed once across every home.
 */
export async function resolvePackageIdentity(
  folder: string,
  podsRoots: PodsRoots = productPodsRoots(),
) {
  if (packageMemberPathSchema.parse(folder).includes("/"))
    throw Error("An output folder must name one immediate Pod directory");
  const named = (entry: { name: string }) => entry.name.toLowerCase() === folder.toLowerCase();
  const claims: { id: string; folder: string; directory: string; manifestSha256: string }[] = [];
  let selected: (typeof claims)[number] | undefined;
  let folders = 0;
  for (const podsRoot of [podsRoots].flat()) {
    const entries = await readdir(podsRoot, { withFileTypes: true }).catch(
      (error: NodeJS.ErrnoException): Dirent[] => {
        if (error.code === "ENOENT") return [];
        throw error;
      },
    );
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (named(entry)) folders++;
      if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
      if (entry.isSymbolicLink()) {
        if (named(entry)) throw Error("Pod folders cannot be links");
        continue;
      }
      try {
        const directory = join(podsRoot, entry.name);
        const captured = await captureDirectory(directory, true);
        const manifest = captured.members.find((member) => member.path === "pod.json");
        if (!manifest || captured.diagnostics.some((issue) => issue.severity === "error"))
          throw Error("Pod has no admitted pod.json");
        const value = JSON.parse(Buffer.from(manifest.bytes).toString("utf8").replace(/^﻿/, ""));
        const claim = {
          id: packageIdSchema.parse(value?.id),
          folder: entry.name,
          directory,
          manifestSha256: manifest.sha256,
        };
        claims.push(claim);
        if (named(entry)) selected = claim;
      } catch (error) {
        if (named(entry)) throw error;
      }
    }
  }
  if (folders !== 1) throw Error("No unique output Pod folder");
  if (!selected || claims.filter((claim) => claim.id === selected.id).length !== 1)
    throw Error("No unique admitted Pod owns this output folder; duplicate manifest identity");
  const pod = await readPackageDirectory(selected.directory, selected.folder);
  if (
    pod.id !== selected.id ||
    pod.members.find((member) => member.path === "pod.json")?.sha256 !== selected.manifestSha256
  )
    throw Error("Pod manifest changed during identity admission");
  await capturePackage(pod);
  return { id: pod.id, folder: pod.folder };
}

/** Admit a known directory; the caller owns its deadline and cancellation. */
export async function readPackageDirectory(
  directory: string,
  folder: string,
  signal?: AbortSignal,
): Promise<AdmittedPackage> {
  const { members, diagnostics } = await captureDirectory(directory, false, signal);
  signal?.throwIfAborted();
  const manifest = members.find((member) => member.path === "pod.json");
  if (!manifest) throw Error("Pod has no admitted pod.json.");
  const value = JSON.parse(
    Buffer.from(manifest.bytes)
      .toString("utf8")
      .replace(/^\uFEFF/, ""),
  );
  packageIdSchema.parse(value?.id);
  const entrypoints: PackageEntrypoint[] = [];
  const model = value.for === undefined ? undefined : podModelSchema.parse(value.for);
  for (const entry of Array.isArray(value.entrypoints) ? value.entrypoints : []) {
    try {
      if (
        Object.keys(entry).some(
          (key) => !["sourcePath", "name", "description", "mode"].includes(key),
        )
      )
        throw Error("Unknown entrypoint field; sourcePath is its identity");
      const path = packageMemberPathSchema.parse(entry.sourcePath);
      if (
        !isCompilerSource(path) ||
        entrypoints.some((item) => item.sourcePath.toLowerCase() === path.toLowerCase())
      )
        throw Error("Invalid or duplicate script sourcePath");
      const mode = scriptModeSchema.nullish().safeParse(entry.mode);
      if (!mode.success)
        throw Error(`${path}: mode must be ReadOnly, WriteTransaction or NoTransaction`);
      entrypoints.push({
        sourcePath: path,
        name: typeof entry.name === "string" ? entry.name : null,
        description: typeof entry.description === "string" ? entry.description : null,
        mode: mode.data ?? null,
      });
      if (!members.some((member) => member.path === path))
        diagnostics.push(
          problem("MissingEntrypoint", path, "Entrypoint has no admitted source file."),
        );
    } catch (error) {
      diagnostics.push(problem("InvalidEntrypoint", "pod.json", message(error)));
    }
  }
  const contributions = members.flatMap((member) => {
    const kind = kindOfMember(member.path, entrypoints);
    if (!kind) return [];
    const path =
      kind === "page" || kind === "skill"
        ? member.path.substring(0, member.path.lastIndexOf("/"))
        : member.path;
    const entry = entrypoints.find((item) => item.sourcePath === member.path);
    try {
      return [
        {
          kind,
          path,
          memberPath: member.path,
          key: contributionKey({ kind, packageId: value.id, path }),
          name: entry?.name ?? path.split("/").at(-1)!,
          description: entry?.description ?? null,
          ...(entry?.mode ? { mode: entry.mode } : {}),
        },
      ];
    } catch (error) {
      diagnostics.push(problem("InvalidContribution", member.path, message(error)));
      return [];
    }
  });
  return {
    id: value.id,
    for: model,
    name: typeof value.name === "string" ? value.name : value.id,
    version: typeof value.version === "string" ? value.version : "",
    folder,
    directory,
    members,
    entrypoints,
    diagnostics: currentDiagnostics(value.id, diagnostics),
    contributions,
  };
}
