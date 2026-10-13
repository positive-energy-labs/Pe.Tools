// Keep the identity of the already installed Dev PWA stable across checkout and process changes.
const devManifestId = "/?dev=e342bc78d3d4";

export function devManifest<T extends Record<string, unknown>>(manifest: T) {
  return {
    ...manifest,
    id: devManifestId,
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
