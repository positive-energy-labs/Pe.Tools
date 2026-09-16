import { lstat, readFile, readdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { productPathNames } from "@pe/host-contracts/contracts";
import type { ScriptingExecute } from "@pe/host-contracts/generated";
import { productUserContentRootPath } from "./product-paths.ts";

type FrozenScript = { sourceBundle: ScriptingExecute.Req.ScriptPodSourceBundle };

// Capture is the only mutable-filesystem read for one admitted execution. Native preparation owns
// manifest rules, composition, integrity, and identity over these captured bytes.
export async function freezeScript(
  input: Record<string, unknown>,
): Promise<FrozenScript | undefined> {
  if (input.sourcePath == null) return undefined;
  if (input.sourceBundle != null) {
    if (Buffer.byteLength(JSON.stringify(input.sourceBundle)) > 5 * 1024 * 1024)
      throw Error("Pod source bundle exceeds 5 MiB wire limit");
    return {
      sourceBundle: structuredClone(
        input.sourceBundle,
      ) as ScriptingExecute.Req.ScriptPodSourceBundle,
    };
  }
  if (input.workspaceKey != null && typeof input.workspaceKey !== "string")
    throw Error("Invalid Pod workspace identity");
  const workspace = (input.workspaceKey as string | undefined) || "default";
  return { sourceBundle: await capturePod(workspace) };
}

export async function capturePod(
  workspace: string,
  podsRoot = join(productUserContentRootPath(), productPathNames.workspacesDirectoryName),
  override?: ScriptingExecute.Req.ScriptPodSourceFile,
): Promise<ScriptingExecute.Req.ScriptPodSourceBundle> {
  validateFolder(workspace);

  const captured = new Map<string, ScriptingExecute.Req.ScriptPodDependencyBundle>();
  const active = new Set<string>();
  const rootFiles = await capture(workspace);
  return { files: rootFiles, dependencies: [...captured.values()] };

  async function capture(id: string): Promise<ScriptingExecute.Req.ScriptPodSourceFile[]> {
    validateFolder(id);
    if (active.has(id)) throw Error(`Pod dependency cycle through '${id}'`);
    active.add(id);
    try {
      const directory = join(podsRoot, id);
      if ((await lstat(directory)).isSymbolicLink())
        throw Error("Pod workspace cannot follow links");
      const files: ScriptingExecute.Req.ScriptPodSourceFile[] = [];
      let directories = 0;
      let bytes = 0;
      const walk = async (relative: string): Promise<void> => {
        if (++directories > 256) throw Error("Pod directory limit exceeded");
        const absolute = relative ? join(directory, relative) : directory;
        if ((await lstat(absolute)).isSymbolicLink()) throw Error("Pod input cannot follow links");
        for (const entry of (await readdir(absolute, { withFileTypes: true })).sort((a, b) =>
          a.name.localeCompare(b.name),
        )) {
          if (entry.isSymbolicLink()) throw Error("Pod input cannot follow links");
          const path = relative ? `${relative}/${entry.name}` : entry.name;
          if (path.length > 1024) throw Error("Pod path exceeds 1024 characters");
          if (entry.isDirectory()) {
            if (
              ["src", "settings", "composed", "assets", "inspection"].some(
                (root) => path === root || path.startsWith(`${root}/`),
              )
            )
              await walk(path);
            continue;
          }
          if (
            !["pod.json", "release.json", "PeScripts.csproj"].includes(path) &&
            !["src/", "settings/", "composed/", "assets/", "inspection/"].some((root) =>
              path.startsWith(root),
            )
          )
            continue;
          const info = await lstat(join(directory, path));
          if (!info.isFile() || info.isSymbolicLink() || info.size > 512 * 1024)
            throw Error(`Pod input must be a bounded regular file: ${path}`);
          const content = await readFile(join(directory, path));
          if ((bytes += content.length) > 4 * 1024 * 1024) throw Error("Pod capture exceeds 4 MiB");
          files.push({ path, bytesBase64: content.toString("base64") });
          if (files.length > 200) throw Error("Pod capture exceeds 200 files");
        }
      };
      await walk("");
      if (id === workspace && override) {
        const index = files.findIndex((file) => file.path === override.path);
        if (index >= 0) files[index] = override;
        else files.push(override);
      }
      if (hasExactReleasedFileSet(files)) return files;
      const manifestFile = files.find((file) => file.path === "pod.json");
      if (!manifestFile) throw Error(`Pod '${id}' has no pod.json`);
      const manifest = JSON.parse(
        Buffer.from(manifestFile.bytesBase64, "base64").toString("utf8"),
      ) as {
        requires?: { id?: unknown; releaseHash?: unknown }[];
      };
      for (const requirement of manifest.requires ?? []) {
        if (typeof requirement.id !== "string" || typeof requirement.releaseHash !== "string")
          throw Error(`Pod '${id}' has an invalid requires entry`);
        if (requirement.id === workspace)
          throw Error(`Pod dependency '${requirement.id}' cannot overwrite the root pod capture`);
        if (captured.has(requirement.id)) continue;
        const dependencyFolder = await resolveDependencyFolder(
          requirement.id,
          requirement.releaseHash,
          podsRoot,
        );
        captured.set(requirement.id, {
          id: requirement.id,
          releaseHash: requirement.releaseHash,
          files: await capture(dependencyFolder),
        });
      }
      return files;
    } finally {
      active.delete(id);
    }
  }
}

function validateFolder(folder: string): void {
  for (const character of folder) {
    if (character.charCodeAt(0) < 32) throw Error(`Invalid local Pod folder '${folder}'`);
  }
  if (!folder || folder !== folder.trim() || /[<>:"/\\|?*]/.test(folder) || /[. ]$/.test(folder))
    throw Error(`Invalid local Pod folder '${folder}'`);
}

async function resolveDependencyFolder(
  id: string,
  releaseHash: string,
  root: string,
): Promise<string> {
  const candidates: { folder: string; exactRelease: boolean }[] = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
    try {
      const manifestPath = join(root, entry.name, "pod.json");
      const info = await lstat(manifestPath);
      if (!info.isFile() || info.isSymbolicLink() || info.size > 512 * 1024) continue;
      const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as { id?: unknown };
      if (manifest.id !== id) continue;
      let exactRelease = false;
      try {
        const releasePath = join(root, entry.name, "release.json");
        const releaseInfo = await lstat(releasePath);
        if (releaseInfo.isFile() && !releaseInfo.isSymbolicLink() && releaseInfo.size <= 512 * 1024)
          exactRelease =
            (JSON.parse(await readFile(releasePath, "utf8")) as { contentHash?: unknown })
              .contentHash === releaseHash;
      } catch {
        /* An authored copy may have no release metadata. */
      }
      candidates.push({ folder: entry.name, exactRelease });
    } catch {
      /* Unreadable unrelated pods cannot block a selected operation. */
    }
  }
  const exact = candidates.filter((candidate) => candidate.exactRelease);
  const selected = exact.length ? exact : candidates;
  if (selected.length === 1) return selected[0]!.folder;
  throw Error(
    selected.length === 0
      ? `No local Pod has identity '${id}' for release '${releaseHash}'`
      : `Pod '${id}' is ambiguous between local folders: ${selected
          .map((candidate) => candidate.folder)
          .sort()
          .join(", ")}`,
  );
}

function hasExactReleasedFileSet(files: ScriptingExecute.Req.ScriptPodSourceFile[]): boolean {
  try {
    const releaseFile = files.find((file) => file.path === "release.json");
    if (!releaseFile) return false;
    const release = JSON.parse(Buffer.from(releaseFile.bytesBase64, "base64").toString("utf8")) as {
      schemaVersion?: unknown;
      files?: { path?: unknown; sha256?: unknown }[];
    };
    if (release.schemaVersion !== 1 || !Array.isArray(release.files)) return false;
    const actual = new Map(
      files.filter((file) => file.path !== "release.json").map((file) => [file.path, file]),
    );
    if (release.files.length !== actual.size) return false;
    const seen = new Set<string>();
    return release.files.every((row) => {
      if (typeof row.path !== "string" || typeof row.sha256 !== "string" || seen.has(row.path))
        return false;
      seen.add(row.path);
      const file = actual.get(row.path);
      return (
        file != null &&
        createHash("sha256").update(Buffer.from(file.bytesBase64, "base64")).digest("hex") ===
          row.sha256
      );
    });
  } catch {
    return false;
  }
}
