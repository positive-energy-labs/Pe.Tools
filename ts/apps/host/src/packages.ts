import {
  contributionKey,
  packageIdSchema,
  packageMemberPathSchema,
  type ContributionKind,
} from "@pe/agent-contracts";
import { createHash } from "node:crypto";
import { lstat, open, readdir } from "node:fs/promises";
import { join } from "node:path";
import type { ScriptingExecute } from "@pe/host-contracts/generated";
import type { MemberIssue } from "@pe/host-contracts/operation-types";
import { productPodsRootPath } from "./product-paths.ts";

export type PackageEntrypoint = {
  sourcePath: string;
  name: string | null;
  description: string | null;
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
};
export type AdmittedPackage = {
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
};
export type CapturedPackage = AdmittedPackage & {
  sourceBundle: ScriptingExecute.Req.ScriptPodSourceBundle;
};

// Membership includes binary families, images, and settings; execution has its own source bounds.
const memberBounds = {
  maxFileBytes: 64 * 1024 * 1024,
  maxTotalBytes: 256 * 1024 * 1024,
  maxFileCount: 4096,
  maxDirectoryCount: 4096,
};

// One exclusion policy for authored input. Portable .state observations remain ordinary members.
const debris = new Set([
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
const authority = new Set([
  "binding.json",
  "grants.json",
  "grant.json",
  "context-token",
  "context-token.json",
  "context-token.txt",
]);

export function isPackageMember(path: string): boolean {
  const parts = packageMemberPathSchema.parse(path).toLowerCase().split("/");
  return (
    !parts.some((part) => debris.has(part)) &&
    !(parts.length === 1 && parts[0] === "imported.json") &&
    !parts.some((part, index) => part === ".state" && authority.has(parts[index + 1] ?? "")) &&
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

/** Read once per snapshot. Hashes, projection, and capture all refer to these exact bytes. */
export async function listPackages(podsRoot = productPodsRootPath()): Promise<PackageListing> {
  const result: PackageListing = { packages: [], unreadable: [] };
  let entries;
  try {
    entries = await readdir(podsRoot, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return result;
    throw error;
  }
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
    try {
      const directory = join(podsRoot, entry.name);
      if (entry.isSymbolicLink()) throw Error("Pod folders cannot be links.");
      try {
        await lstat(join(directory, "pod.json"));
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
        throw error;
      }
      result.packages.push(await readFolder(directory, entry.name));
    } catch (error) {
      result.unreadable.push({ folder: entry.name, message: message(error) });
    }
  }
  for (const pod of result.packages) {
    const twins = result.packages.filter((other) => other.id === pod.id);
    if (twins.length > 1) {
      pod.diagnostics.unshift(
        problem(
          "DuplicatePodId",
          "pod.json",
          `Pod id '${pod.id}' is claimed by folders ${twins.map((twin) => twin.folder).join(", ")}.`,
        ),
      );
      pod.contributions = [];
    }
  }
  return result;
}

/** Resolve manifest identity, never a folder alias. Diagnostics stay inspectable in listings. */
export async function readPackage(
  id: string,
  podsRoot = productPodsRootPath(),
): Promise<AdmittedPackage> {
  const found = (await listPackages(podsRoot)).packages.filter((pod) => pod.id === id);
  if (found.length !== 1)
    throw Error(
      found.length
        ? `Pod id '${id}' is claimed by folders ${found.map((pod) => pod.folder).join(", ")}.`
        : `No installed pod has id '${id}'.`,
    );
  return found[0]!;
}

/** Freeze admitted bytes without rereading disk. Admission errors refuse; member semantics stay native. */
export async function capturePackage(
  packageOrId: AdmittedPackage | string,
  podsRoot = productPodsRootPath(),
): Promise<CapturedPackage> {
  const pod =
    typeof packageOrId === "string" ? await readPackage(packageOrId, podsRoot) : packageOrId;
  const errors = pod.diagnostics.filter((issue) =>
    ["PackageMemberInvalid", "DuplicatePodId"].includes(issue.code),
  );
  if (errors.length)
    throw Error(errors.map((issue) => `${issue.path}: ${issue.message}`).join("; "));
  return {
    ...pod,
    sourceBundle: {
      files: pod.members.map((member) => ({
        path: member.path,
        bytesBase64: Buffer.from(member.bytes).toString("base64"),
      })),
    },
  };
}

export async function captureDirectory(
  directory: string,
): Promise<{ members: PackageMember[]; diagnostics: MemberIssue[] }> {
  const members: PackageMember[] = [];
  const diagnostics: MemberIssue[] = [];
  const names = new Set<string>();
  let directories = 0,
    files = 0,
    total = 0;
  const walk = async (relative: string): Promise<void> => {
    if (++directories > memberBounds.maxDirectoryCount) throw Error("Pod directory limit exceeded");
    const absolute = join(directory, relative);
    if ((await lstat(absolute)).isSymbolicLink()) throw Error("Pod directories cannot be links");
    for (const entry of (await readdir(absolute, { withFileTypes: true })).sort((a, b) =>
      a.name.localeCompare(b.name),
    )) {
      const path = relative ? `${relative}/${entry.name}` : entry.name;
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
        if (!info.isFile() || info.isSymbolicLink())
          throw Error("Pod input must be a regular file");
        if (info.size > memberBounds.maxFileBytes)
          throw Error(`Pod member exceeds ${memberBounds.maxFileBytes} bytes`);
        if ((total += info.size) > memberBounds.maxTotalBytes)
          throw Error(`Pod members exceed ${memberBounds.maxTotalBytes} total bytes`);
        const handle = await open(join(directory, path), "r");
        let bytes: Buffer;
        try {
          const stat = await handle.stat();
          if (!stat.isFile() || stat.ino !== info.ino || stat.size !== info.size)
            throw Error("Pod input changed during capture");
          bytes = Buffer.alloc(stat.size + 1);
          let count = 0;
          while (count < bytes.length) {
            const read = await handle.read(bytes, count, bytes.length - count, null);
            if (!read.bytesRead) break;
            count += read.bytesRead;
          }
          bytes = bytes.subarray(0, count);
        } finally {
          await handle.close();
        }
        if (bytes.length !== info.size) throw Error("Pod input changed during capture");
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

async function readFolder(directory: string, folder: string): Promise<AdmittedPackage> {
  const { members, diagnostics } = await captureDirectory(directory);
  const manifest = members.find((member) => member.path === "pod.json");
  if (!manifest) throw Error("Pod has no admitted pod.json.");
  const value = JSON.parse(
    Buffer.from(manifest.bytes)
      .toString("utf8")
      .replace(/^\uFEFF/, ""),
  );
  packageIdSchema.parse(value?.id);
  const entrypoints: PackageEntrypoint[] = [];
  for (const entry of Array.isArray(value.entrypoints) ? value.entrypoints : []) {
    try {
      if (Object.keys(entry).some((key) => !["sourcePath", "name", "description"].includes(key)))
        throw Error("Unknown entrypoint field; sourcePath is its identity");
      const path = packageMemberPathSchema.parse(entry.sourcePath);
      if (
        !(path.startsWith("src/") && /^src\/.+\.cs$/i.test(path)) ||
        entrypoints.some((item) => item.sourcePath.toLowerCase() === path.toLowerCase())
      )
        throw Error("Invalid or duplicate script sourcePath");
      entrypoints.push({
        sourcePath: path,
        name: typeof entry.name === "string" ? entry.name : null,
        description: typeof entry.description === "string" ? entry.description : null,
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
        },
      ];
    } catch (error) {
      diagnostics.push(problem("InvalidContribution", member.path, message(error)));
      return [];
    }
  });
  return {
    id: value.id,
    name: typeof value.name === "string" ? value.name : value.id,
    version: typeof value.version === "string" ? value.version : "",
    folder,
    directory,
    members,
    entrypoints,
    diagnostics,
    contributions,
  };
}

const problem = (code: string, path: string, message: string): MemberIssue => ({
  code,
  path,
  message,
  severity: "error",
});
const message = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);
