// Lowers effect-islands.baseline.json to the current census. Refuses to raise a count or add a
// file: a growing island set is the thing the ratchet exists to stop.
import { readFileSync, writeFileSync } from "node:fs";
import { census, type Islands } from "./effect-islands-census.ts";

const path = new URL("./effect-islands.baseline.json", import.meta.url);
const actual = census();
const next: Islands = { src: {}, tests: {} };
let growth = 0;
const baseline = JSON.parse(readFileSync(path, "utf8")) as Islands;
for (const kind of ["src", "tests"] as const) {
  for (const [file, count] of Object.entries(actual[kind])) {
    const cap = baseline[kind][file];
    if (cap === undefined || count > cap) {
      console.error(`${file}: ${cap ?? "none"} -> ${count} (refused: islands only shrink)`);
      growth++;
    } else {
      if (count < cap) console.log(`${file}: ${cap} -> ${count}`);
      next[kind][file] = count;
    }
  }
}
if (growth > 0) process.exit(1);
writeFileSync(path, `${JSON.stringify(next, null, 2)}\n`);
