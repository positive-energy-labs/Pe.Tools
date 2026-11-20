import { FAMILY_MEMBER_DIR } from "@pe/agent-contracts";
import { readFile } from "node:fs/promises";
import { extname, isAbsolute, posix, relative, resolve } from "node:path";
import { NodeServices } from "@effect/platform-node";
import { Effect } from "effect";
import { type PodDependencies } from "./family-actions.ts";
import { podFolder } from "./settings.ts";

const safePath = (root: string, path: string) => {
  const full = resolve(root, path);
  const local = relative(root, full);
  if (!local || local.startsWith("..") || isAbsolute(local)) throw Error("Invalid pod asset path");
  return full;
};
const folderFor = (pod: string, podsRoot?: PodDependencies["podsRoot"], pointer?: string | null) =>
  // effect-edge: island, phase 5
  Effect.runPromise(podFolder(pod, { podsRoot, pointer }).pipe(Effect.provide(NodeServices.layer)));

/** Assets and sidecars are served from the selected pod, without a parse cache or API key. */
export async function familySpecAsset(
  url: URL,
  podsRoot?: PodDependencies["podsRoot"],
  pointer?: string | null,
): Promise<Response> {
  try {
    // Normalized before the prefix test: `settings/family/../../x` names another Pod file.
    const path = posix.normalize((url.searchParams.get("path") ?? "").replaceAll("\\", "/"));
    if (!path.startsWith(FAMILY_MEMBER_DIR)) throw Error("Expected a family spec asset");
    const file = safePath(
      await folderFor(url.searchParams.get("pod") ?? "", podsRoot, pointer),
      path,
    );
    const bytes = await readFile(file);
    const mime =
      (
        {
          ".json": "application/json",
          ".png": "image/png",
          ".jpg": "image/jpeg",
          ".pdf": "application/pdf",
        } as Record<string, string>
      )[extname(file)] ?? "application/octet-stream";
    return new Response(bytes, {
      headers: { "content-type": mime, "x-content-type-options": "nosniff" },
    });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 404 },
    );
  }
}
