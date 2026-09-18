import { lstat, readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { productPathNames } from "@pe/host-contracts/contracts";
import { scriptPodSourceBounds, type ScriptingExecute } from "@pe/host-contracts/generated";
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
  podsRoot = join(productUserContentRootPath(), productPathNames.podsDirectoryName),
): Promise<ScriptingExecute.Req.ScriptPodSourceBundle> {
  validateFolder(workspace);
  const directory = join(podsRoot, workspace);
  if ((await lstat(directory)).isSymbolicLink()) throw Error("Pod workspace cannot follow links");
  const files: ScriptingExecute.Req.ScriptPodSourceFile[] = [];
  let directories = 0;
  let bytes = 0;
  const walk = async (relative: string): Promise<void> => {
    if (++directories > scriptPodSourceBounds.maxDirectoryCount)
      throw Error("Pod directory limit exceeded");
    const absolute = relative ? join(directory, relative) : directory;
    for (const entry of (await readdir(absolute, { withFileTypes: true })).sort((a, b) =>
      a.name.localeCompare(b.name),
    )) {
      if (entry.isSymbolicLink()) throw Error("Pod input cannot follow links");
      const path = relative ? `${relative}/${entry.name}` : entry.name;
      if (path.length > 1024) throw Error("Pod path exceeds 1024 characters");
      const root = path.split("/")[0]!;
      if (entry.isDirectory()) {
        if (["src", "settings", "assets"].includes(root)) await walk(path);
        continue;
      }
      if (
        path !== "pod.json" &&
        path !== "PeScripts.csproj" &&
        !["src", "settings", "assets"].includes(root)
      )
        continue;
      const info = await lstat(join(directory, path));
      if (!info.isFile() || info.size > scriptPodSourceBounds.maxFileBytes)
        throw Error(`Pod input must be a bounded regular file: ${path}`);
      const content = await readFile(join(directory, path));
      if ((bytes += content.length) > scriptPodSourceBounds.maxTotalBytes)
        throw Error(`Pod capture exceeds ${scriptPodSourceBounds.maxTotalBytes} bytes`);
      files.push({ path, bytesBase64: content.toString("base64") });
      if (files.length > scriptPodSourceBounds.maxFileCount)
        throw Error(`Pod capture exceeds ${scriptPodSourceBounds.maxFileCount} files`);
    }
  };
  await walk("");
  return { files };
}

function validateFolder(folder: string): void {
  for (const character of folder) {
    if (character.charCodeAt(0) < 32) throw Error(`Invalid local Pod folder '${folder}'`);
  }
  if (!folder || folder !== folder.trim() || /[<>:"/\\|?*]/.test(folder) || /[. ]$/.test(folder))
    throw Error(`Invalid local Pod folder '${folder}'`);
}
