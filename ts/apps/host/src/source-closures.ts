import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

declare const __PE_SOURCE_COMMIT__: string;

/** ADR 0029 rule 4 exception: this source bootstrap runs before the Effect graph has a process scope.
 * Builtin closures are untracked build output that the host graph imports from disk under jiti.
 * Every source host entry awaits this BEFORE dynamically importing the host graph: static imports
 * link before any top-level code runs, so a missing closure would fail first. The pack producer's
 * baked commit identifies inlined closures in both Node and SEA; neither runs the source generator.
 * Browser-worker/ACP adapter modes never load the host graph. */
export async function prepareSourceClosures() {
  if (typeof __PE_SOURCE_COMMIT__ !== "undefined") return;
  await promisify(execFile)(process.execPath, [
    fileURLToPath(new URL("../../web/scripts/route-graphs.ts", import.meta.url)),
    "--builtin-closure-only",
  ]);
}
