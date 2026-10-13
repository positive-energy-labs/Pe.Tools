import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { Plugin } from "vite-plus";
import { checkoutRootFrom } from "@pe/host-contracts/service-identity";
import { devManifest } from "./dev-manifest.ts";

/** The dev server marks the same leaf; packaged production assets stay unchanged. */
export function devIcons(): Plugin {
  const files: Record<string, [string, string]> = {
    "/favicon.ico": ["favicon-dev.ico", "image/x-icon"],
    "/logo192.png": ["logo192-dev.png", "image/png"],
    "/logo512.png": ["logo512-dev.png", "image/png"],
  };
  return {
    name: "pe:dev-icons",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use(async (request, response, next) => {
        if ((request.url ?? "").split("?")[0] === "/manifest.json") {
          try {
            const sourceRoot = checkoutRootFrom(server.config.root);
            if (!sourceRoot) throw new Error("Dev manifest has no checkout identity");
            const manifest = JSON.parse(
              await readFile(join(server.config.root, "public", "manifest.json"), "utf8"),
            );
            response.setHeader("Content-Type", "application/manifest+json");
            response.setHeader("Cache-Control", "no-store");
            response.end(JSON.stringify(devManifest(sourceRoot, manifest)));
          } catch (error) {
            next(error);
          }
          return;
        }
        const file = files[(request.url ?? "").split("?")[0]!];
        if (!file) return next();
        try {
          const bytes = await readFile(join(server.config.root, "public", file[0]));
          response.setHeader("Content-Type", file[1]);
          response.setHeader("Cache-Control", "no-store");
          response.end(bytes);
        } catch (error) {
          next(error);
        }
      });
    },
  };
}
