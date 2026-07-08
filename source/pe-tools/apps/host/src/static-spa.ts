import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { Layer } from "effect";
import { HttpStaticServer } from "effect/unstable/http";
import { hostOwnership } from "./host-ownership.ts";

/**
 * Where the built SPA lives (Pillar 5):
 * - installed lane: `<exeDir>/web/client` (the contract with the C# packaging side).
 * - dev: `PE_TOOLS_WEB_DIST` if set (dev usually runs vite with HMR instead, so this is normally
 *   unset and static serving is skipped).
 */
export function resolveWebRoot(): string | null {
  if (hostOwnership.lane === "installed") {
    return join(dirname(process.execPath), "web", "client");
  }
  return process.env.PE_TOOLS_WEB_DIST?.trim() || null;
}

/**
 * SPA static layer, mounted at `GET /*` and merged LAST so API routes win. Its deps
 * (FileSystem/Path/HttpPlatform/Etag) are already bundled by `NodeHttpServer.layer`. When the root
 * is absent (dev without a build) the layer is a no-op so the server still starts.
 */
export function staticSpaLayer(root: string | null) {
  if (!root || !existsSync(root)) return Layer.empty;
  return HttpStaticServer.layer({ root, spa: true, index: "index.html" });
}
