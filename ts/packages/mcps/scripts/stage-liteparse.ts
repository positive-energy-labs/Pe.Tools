import { copyFile, mkdir } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

/** What LiteParse reads from disk at run time. A SEA blob cannot carry either: Node loads a `.node` by path, and the binding loads pdfium by path. */
export const liteParseNativeFiles = ["liteparse.win32-x64-msvc.node", "pdfium.dll"] as const;

/**
 * Stages the win32-x64 LiteParse binary beside a SEA executable. Bundled LiteParse finds no platform
 * package, then searches its own directory for `liteparse.<triple>.node`; in a SEA that directory is
 * the executable's. Fails the pack when the platform package is not installed.
 */
export function liteParseNativePlugin(directory: string) {
  return {
    name: "stage-liteparse-native",
    async closeBundle() {
      const fromLiteParse = createRequire(
        createRequire(import.meta.url).resolve("@llamaindex/liteparse"),
      );
      const source = dirname(
        fromLiteParse.resolve("@llamaindex/liteparse-win32-x64-msvc/package.json"),
      );
      await mkdir(directory, { recursive: true });
      for (const file of liteParseNativeFiles)
        await copyFile(join(source, file), join(directory, file));
    },
  };
}
