import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { randomUUID } from "node:crypto";

import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { routeStartupOwner, routeStartupSourceHash, currentRouteStartupProjection, readRouteStartupReceipt } from "@pe/host-contracts/route-startup";
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
  await prepareDevRouteProjection();
}

/** Source hosts share one producer receipt. Dev also hands the result to its frontend.
 * The producer (18 route closure builds, about a minute) is NOT on the start path while the receipt
 * its last full run left (`codegen:routes`, or an earlier start) is still current by content hash.
 * tests/source-closures.test.ts holds that. A miss produces, and the producer stores a new receipt. */
export async function prepareDevRouteProjection(): Promise<RouteStartupProjection> {
  const root = fileURLToPath(new URL("../../../../", import.meta.url));
  let receipt = readRouteStartupReceipt(root);
  let current = !!receipt;
  if (!receipt) {
    const sourceHash = routeStartupSourceHash(root);
    const { stdout } = await promisify(execFile)(process.execPath, [
      fileURLToPath(new URL("../../web/scripts/route-graphs.ts", import.meta.url)), "--runtime",
    ], { maxBuffer: 16 * 1024 * 1024 });
    receipt = { checkout: routeStartupOwner(root), sourceHash, projections: JSON.parse(stdout) };
    current = currentRouteStartupProjection(root, receipt);
  }
  // Refuse a source/producer race before the host links the closures it produced.
  if (!current) throw new Error("Route sources changed during startup projection; retry startup.");
  // The host graph still imports ignored closure pins from disk before linking under jiti.
  for (const [path, text] of Object.entries(receipt.projections)) {
    if (!path.endsWith("source-closure.generated.json")) continue;
    try { if (await readFile(path, "utf8") === text) continue; }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    await mkdir(dirname(path), { recursive: true });
    const temp = `${path}.${process.pid}.${randomUUID()}`;
    try {
      await writeFile(temp, text);
      await rename(temp, path);
    } finally { await rm(temp, { force: true }); }
  }
  if (!currentRouteStartupProjection(root, receipt))
    throw new Error("Route sources changed during startup publication; retry startup.");
  return receipt;
}
