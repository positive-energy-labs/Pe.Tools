import { lstat, readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { productPathNames } from "@pe/host-contracts/contracts";
import type { ScriptingExecute } from "@pe/host-contracts/generated";
import { productUserContentRootPath } from "./product-paths.ts";

type FrozenScript = { sourceBundle: ScriptingExecute.Req.ScriptPodSourceBundle };

// Sequential capture seals the exact returned set, not an atomic directory snapshot.
// Native normalization owns Pod semantics; no captured inputs are materialized or relocated.
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
  const directory = join(
    productUserContentRootPath(),
    productPathNames.workspacesDirectoryName,
    workspace,
  );
  let total = 0;
  let directories = 0;
  const sources: ScriptingExecute.Req.ScriptPodSourceFile[] = [];
  const read = async (path: string, source = false) => {
    const location = join(directory, path);
    const info = await lstat(location);
    if (!info.isFile() || info.isSymbolicLink() || info.size > 512 * 1024)
      throw Error("Pod input must be a bounded regular file");
    const bytes = await readFile(location);
    if (bytes.length > 512 * 1024) throw Error("Pod file exceeds 512 KiB");
    if (source && (total += bytes.length) > 2 * 1024 * 1024)
      throw Error("Pod source exceeds 2 MiB");
    return bytes.toString("base64");
  };
  const walk = async (path: string): Promise<void> => {
    if (++directories > 256) throw Error("Pod source directory limit exceeded");
    if ((await lstat(join(directory, path))).isSymbolicLink())
      throw Error("Pod input cannot follow links");
    const entries = await readdir(join(directory, path), { withFileTypes: true });
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (entry.isSymbolicLink()) throw Error("Pod input cannot follow links");
      const name = `${path}/${entry.name}`;
      if (name.length > 1024) throw Error("Pod source path exceeds 1024 characters");
      if (entry.isDirectory()) await walk(name);
      else if (entry.name.toLowerCase().endsWith(".cs")) {
        if (sources.length >= 200) throw Error("Too many Pod source files");
        sources.push({ path: name, bytesBase64: await read(name, true) });
      }
    }
  };
  if ((await lstat(directory)).isSymbolicLink()) throw Error("Pod workspace cannot follow links");
  const manifestBase64 = await read("pod.json");
  await walk("src");
  const projectBytes = await read("PeScripts.csproj").catch((error: NodeJS.ErrnoException) => {
    if (error.code !== "ENOENT") throw error;
    return null;
  });
  return {
    sourceBundle: {
      manifestBase64,
      project: { present: projectBytes !== null, bytesBase64: projectBytes },
      sources,
    },
  };
}
