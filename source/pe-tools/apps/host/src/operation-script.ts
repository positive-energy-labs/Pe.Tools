import { lstat, readFile, readdir } from "node:fs/promises";
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
  const workspace = (input.workspaceKey as string | undefined)?.trim() || "default";
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(workspace)) throw Error("Invalid Pod workspace identity");

  const captured = new Map<string, ScriptingExecute.Req.ScriptPodDependencyBundle>();
  const active = new Set<string>();
  const rootFiles = await capture(workspace);
  return { sourceBundle: { files: rootFiles, dependencies: [...captured.values()] } };

  async function capture(id: string): Promise<ScriptingExecute.Req.ScriptPodSourceFile[]> {
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id))
      throw Error(`Invalid required Pod identity '${id}'`);
    if (active.has(id)) throw Error(`Pod dependency cycle through '${id}'`);
    active.add(id);
    try {
      const directory = join(
        productUserContentRootPath(),
        productPathNames.workspacesDirectoryName,
        id,
      );
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
        const dependencyDirectory = join(
          productUserContentRootPath(),
          productPathNames.workspacesDirectoryName,
          requirement.id,
        );
        try {
          await lstat(dependencyDirectory);
        } catch (error) {
          if (
            files.some((file) => file.path === "release.json") &&
            (error as NodeJS.ErrnoException).code === "ENOENT"
          )
            continue;
          throw error;
        }
        captured.set(requirement.id, {
          id: requirement.id,
          releaseHash: requirement.releaseHash,
          files: await capture(requirement.id),
        });
      }
      return files;
    } finally {
      active.delete(id);
    }
  }
}
