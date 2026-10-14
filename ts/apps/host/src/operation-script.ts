import { join } from "node:path";
import { productPathNames } from "@pe/host-contracts/contracts";
import {
  scriptPodMemberBounds,
  scriptPodSourceBounds,
  type ScriptingExecute,
} from "@pe/host-contracts/generated";
import {
  capturePackage,
  isCompilerInput,
  isCompilerSource,
  isPackageMember,
  listPackages,
} from "./packages.ts";
import { productUserContentRootPath } from "./product-paths.ts";
import { BridgeError } from "./bridge.ts";
import { requirePackageEnabled } from "./package-lifecycle.ts";

export function requireScriptSuccess(value: unknown): void {
  const status = value && typeof value === "object" && "status" in value ? value.status : undefined;
  if (status === "Succeeded") return;
  throw new BridgeError(
    `Script execution ${typeof status === "string" ? status : "returned no valid status"}`,
    status === "Cancelled" ? 499 : 422,
    {
      dispatched: true,
      result: value,
    },
  );
}

type FrozenScript = { sourceBundle: ScriptingExecute.Req.ScriptPodSourceBundle };

// Capture is the only mutable-filesystem read for one admitted execution. Native preparation owns
// manifest rules, composition, integrity, and identity over these captured bytes.
export async function freezeScript(
  input: Record<string, unknown>,
): Promise<FrozenScript | undefined> {
  if (input.sourcePath == null) return undefined;
  if (input.sourceBundle != null) {
    const sourceBundle = structuredClone(
      input.sourceBundle,
    ) as ScriptingExecute.Req.ScriptPodSourceBundle;
    const manifest = sourceBundle.files?.find((file) => file.path === "pod.json");
    if (manifest) {
      let id: unknown;
      try {
        id = JSON.parse(
          Buffer.from(manifest.bytesBase64, "base64")
            .toString("utf8")
            .replace(/^\uFEFF/, ""),
        ).id;
      } catch {
        /* Native preparation owns malformed manifest refusal. */
      }
      if (typeof id === "string") await requirePackageEnabled(id);
    }
    const bounds = scriptPodMemberBounds;
    let sourceTotal = 0;
    let sourceCount = 0;
    const sourceDirectories = new Set<string>(["", "src"]);
    if (!Array.isArray(sourceBundle.files) || sourceBundle.files.length > bounds.maxFileCount)
      throw Error("Invalid Pod source bundle file count");
    const paths = new Set<string>();
    const directories = new Map<string, string>([["", ""]]);
    let total = 0;
    for (const file of sourceBundle.files) {
      if (!file || typeof file.path !== "string" || !isPackageMember(file.path))
        throw Error("Invalid captured Pod member");
      const folded = file.path.toLowerCase();
      if (paths.has(folded)) throw Error(`Duplicate Pod path: ${file.path}`);
      paths.add(folded);
      if (
        typeof file.bytesBase64 !== "string" ||
        file.bytesBase64.length > Math.ceil(bounds.maxFileBytes / 3) * 4
      )
        throw Error("Captured Pod file exceeds bounds");
      const bytes = Buffer.from(file.bytesBase64, "base64");
      if (bytes.toString("base64") !== file.bytesBase64)
        throw Error("Captured Pod file is not canonical base64");
      if (bytes.length > bounds.maxFileBytes || (total += bytes.length) > bounds.maxTotalBytes)
        throw Error("Captured Pod exceeds byte bounds");
      if (
        isCompilerSource(file.path) &&
        (++sourceCount > scriptPodSourceBounds.maxFileCount ||
          bytes.length > scriptPodSourceBounds.maxFileBytes ||
          (sourceTotal += bytes.length) > scriptPodSourceBounds.maxTotalBytes)
      )
        throw Error("Captured Pod source exceeds byte bounds or file count");
      const parts = file.path.split("/");
      for (let count = 1; count < parts.length; count++) {
        const directory = parts.slice(0, count).join("/");
        const previous = directories.get(directory.toLowerCase());
        if (previous && previous !== directory) throw Error("Case-colliding Pod directory");
        directories.set(directory.toLowerCase(), directory);
        if (isCompilerSource(file.path)) sourceDirectories.add(directory);
      }
    }
    if (
      sourceDirectories.size > scriptPodSourceBounds.maxDirectoryCount ||
      directories.size > bounds.maxDirectoryCount ||
      [...directories.keys()].some((path) => paths.has(path))
    )
      throw Error("Invalid captured Pod directories");
    return {
      sourceBundle: { files: sourceBundle.files.filter((file) => isCompilerInput(file.path)) },
    };
  }
  if (input.workspaceKey != null && typeof input.workspaceKey !== "string")
    throw Error("Invalid Pod workspace identity");
  const workspace = (input.workspaceKey as string | undefined) || "default";
  const root = join(productUserContentRootPath(), productPathNames.podsDirectoryName);
  const listing = await listPackages(root);
  const pod = listing.packages.find((pod) => pod.folder === workspace);
  if (!pod) throw Error(`No admitted Pod in workspace '${workspace}'.`);
  return freezeScript({ ...input, sourceBundle: (await capturePackage(pod, root)).sourceBundle });
}
