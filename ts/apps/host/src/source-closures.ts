import { execFile } from "node:child_process";
import { isSea } from "node:sea";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

/** ADR 0029 rule 4 exception: this build bootstrap runs before the Effect graph has a process scope; SEA skips it.
 * Builtin closures are untracked build output that the host graph imports from disk under jiti.
 * Every source host entry awaits this BEFORE dynamically importing the host graph: static imports
 * link before any top-level code runs, so a missing closure would fail first. The SEA bundle
 * inlined closures at pack, and browser-worker/ACP adapter modes never load the host graph. */
export async function prepareSourceClosures() {
  if (isSea()) return;
  await promisify(execFile)(process.execPath, [
    fileURLToPath(new URL("../../web/scripts/route-graphs.ts", import.meta.url)),
    "--builtin-closure-only",
  ]);
}
