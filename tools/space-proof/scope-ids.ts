// Focus ids per /ducts system, from a saved `ducts.snapshot` call. `members` is what the gate pins:
// the raw snapshot's `scopeOf` members. `page` is what the /ducts model picture sends before pricing
// (ducts/proto/e/screen.tsx + picture.tsx -> ducts/page.ts `ductsFocus` -> scene/picture `captureRequest`):
// those members plus the connector stubs of `neighboursOf` at the DUCTS_MULTI defaults (stubFt 10,
// same-classification hop). Priced (`drawn`) members join only after pricing and are not modelled here.
// usage (from ts/apps/pea): vp exec jiti <this file> <snapshot.out> <system> [<system>...]
//   -> JSON on stdout: { members: {system: ids|null}, page: {system: ids|null} }
import { readFileSync } from "node:fs";
import { scopeOf } from "../../ts/packages/ducts-domain/src/system-scope.ts";
import { neighboursOf } from "../../ts/packages/ducts-domain/src/neighbours.ts";

const raw = readFileSync(process.argv[2]!, "utf8");
const snapshot = JSON.parse(raw.slice(raw.indexOf("{"))).response;
const members: Record<string, number[] | null> = {};
const page: Record<string, number[] | null> = {};
const sorted = (ids: Iterable<number>) => [...new Set(ids)].filter((id) => id > 0).sort((a, b) => a - b);
for (const system of process.argv.slice(3)) {
  const scope = scopeOf(snapshot, [system]);
  if (!scope) {
    members[system] = page[system] = null;
    continue;
  }
  const stubs = neighboursOf(snapshot, scope.members, { stubFt: 10, hop: "same-classification" })
    .flatMap((n) => n.stub)
    .filter((id) => !scope.members.has(id));
  members[system] = sorted(scope.members);
  page[system] = sorted([...scope.members, ...stubs]);
}
console.log(JSON.stringify({ members, page }));
