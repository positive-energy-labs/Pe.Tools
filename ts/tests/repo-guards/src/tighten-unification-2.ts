// Lowers unification-2.baseline.json to the current census. Never raises a cap: the guard test
// only reads the baseline, so a ceiling moves only when a person runs `pnpm ratchets:tighten`.
import { readFileSync, writeFileSync } from "node:fs";
import { census } from "./unification-2-census.ts";

const path = new URL("./unification-2.baseline.json", import.meta.url);
const baseline = JSON.parse(readFileSync(path, "utf8")) as Record<string, number>;
const actual = census();
for (const [law, cap] of Object.entries(baseline)) {
  const offenders = actual[law]!.length;
  if (offenders < cap) {
    console.log(`${law}: ${cap} -> ${offenders}`);
    baseline[law] = offenders;
  }
}
writeFileSync(path, `${JSON.stringify(baseline, null, 2)}\n`);
