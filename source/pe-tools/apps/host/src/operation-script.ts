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
  podsRoot = join(productUserContentRootPath(), productPathNames.podsDirectoryName),
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
