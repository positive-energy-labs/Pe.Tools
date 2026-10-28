// Focus ids per /ducts system: the members `sceneRequestOf` (ts/apps/web/src/ducts/manifest.ts) sends for an
// opened system, from a saved `ducts.snapshot` call. Drawn and stub ids are priced-layer extras and are not included.
// usage (from ts/apps/pea): vp exec jiti <this file> <snapshot.out> <system> [<system>...]  -> JSON on stdout
import { readFileSync } from "node:fs";
import { scopeOf } from "../../ts/packages/ducts-domain/src/system-scope.ts";

const raw = readFileSync(process.argv[2]!, "utf8");
const snapshot = JSON.parse(raw.slice(raw.indexOf("{"))).response;
const out: Record<string, number[] | null> = {};
for (const system of process.argv.slice(3)) {
  const scope = scopeOf(snapshot, [system]);
  out[system] = scope ? [...scope.members].filter((id) => id > 0).sort((a, b) => a - b) : null;
}
console.log(JSON.stringify(out));
