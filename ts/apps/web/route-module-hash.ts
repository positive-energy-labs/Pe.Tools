import { routeSourceHash } from "./route-source-hash.ts";
import { readFileSync } from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import type { Plugin } from "vite-plus";

const exec = promisify(execFile);
const graphFile = /[\\/]src[\\/][^/\\]+[\\/]graph\.ts$/;
async function generateRoutes() {
  // A fresh process avoids retaining jiti's previously imported graph declarations during watch.
  await exec(process.execPath, [
    fileURLToPath(new URL("./scripts/route-graphs.ts", import.meta.url)),
  ]);
  await exec(process.execPath, [
    fileURLToPath(
      new URL("../../packages/agent-contracts/scripts/route-links-cs.ts", import.meta.url),
    ),
  ]);
}

/** Generate before bundling and before graph HMR; admission still checks the actual compiled bytes. */
export function routeModuleHash(generate = generateRoutes): Plugin {
  let pending: Promise<void> = Promise.resolve();
  const refresh = () => (pending = pending.then(generate, generate));
  return {
    name: "route-module-hash",
    enforce: "pre",
    async buildStart() {
      await refresh();
    },
    async handleHotUpdate({ file, server }) {
      if (!graphFile.test(file)) return;
      await refresh();
      // Graphs register at module scope. Replace graph + directory together, never HMR one half.
      server.moduleGraph.invalidateAll();
      server.ws.send({ type: "full-reload" });
      return [];
    },
    async transform(code, id) {
      // A request arriving during regeneration must not see a new graph with the old directory.
      await pending;
      if (!graphFile.test(id)) return;
      const hash = routeSourceHash(readFileSync(id));
      return {
        code: code.replace(/\bdirectory\s*:/g, `moduleHash: "${hash}", directory:`),
        map: null,
      };
    },
  };
}
