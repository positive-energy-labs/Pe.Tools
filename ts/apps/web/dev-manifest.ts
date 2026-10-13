import { createHash } from "node:crypto";

/** Install identity follows the checkout, never the current backend process or transient port. */
export function devManifest<T extends Record<string, unknown>>(sourceRoot: string, manifest: T) {
  const identity = createHash("sha256")
    .update(sourceRoot.replaceAll("\\", "/").toLowerCase())
    .digest("hex")
    .slice(0, 12);
  return {
    ...manifest,
    id: `/?dev=${identity}`,
    name: "Pe.Tools Dev",
    short_name: "Pe.Tools Dev",
    start_url: "/open",
    icons: [
      {
        src: "/favicon.ico",
        sizes: "16x16 24x24 32x32 48x48 64x64 128x128 256x256",
        type: "image/x-icon",
      },
      { src: "/logo192.png", sizes: "192x192", type: "image/png" },
      { src: "/logo512.png", sizes: "512x512", type: "image/png" },
    ],
  };
}
