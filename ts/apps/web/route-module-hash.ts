import { routeSourceHash } from "./route-source-hash.ts";
import { readFileSync } from "node:fs";
import type { Plugin } from "vite-plus";

/** Stamp the bytes actually compiled, independently of the generated directory. */
export function routeModuleHash(): Plugin {
  return {
    name: "route-module-hash",
    enforce: "pre",
    transform(code, id) {
      if (!/[\\/]src[\\/][^/\\]+[\\/]graph\.ts$/.test(id)) return;
      const hash = routeSourceHash(readFileSync(id));
      return {
        code: code.replace(/\bdirectory\s*:/g, `moduleHash: "${hash}", directory:`),
        map: null,
      };
    },
  };
}
