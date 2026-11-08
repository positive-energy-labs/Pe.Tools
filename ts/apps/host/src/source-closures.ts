import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { routeStartupOwner, routeStartupSourceHash, currentRouteStartupProjection } from "@pe/host-contracts/route-startup";
import type { RouteStartupProjection } from "@pe/host-contracts/route-startup";

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

/** Dev alone hands the complete producer result to its frontend; pack/source-only keep their lane. */
export async function prepareDevRouteProjection(): Promise<RouteStartupProjection | undefined> {
  const root = fileURLToPath(new URL("../../../../", import.meta.url));
  const sourceHash = routeStartupSourceHash(root);
  const { stdout } = await promisify(execFile)(process.execPath, [
    fileURLToPath(new URL("../../web/scripts/route-graphs.ts", import.meta.url)), "--runtime",
  ], { maxBuffer: 16 * 1024 * 1024 });
  const receipt: RouteStartupProjection = {
    checkout: routeStartupOwner(root), sourceHash, projections: JSON.parse(stdout),
  };
  const current = currentRouteStartupProjection(root, receipt);
  // The host graph still imports ignored closure pins from disk before linking under jiti.
  for (const [path, text] of Object.entries(receipt.projections)) {
    if (!path.endsWith("source-closure.generated.json")) continue;
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, text);
  }
  return current ? receipt : undefined;
}
