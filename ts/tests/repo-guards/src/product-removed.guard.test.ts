import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { expect, test } from "vite-plus/test";

// ponytail: one whole-program check per product, about 30 s each (measured 16, 30, 34 and 39 s
// through the CLI). Shrink the program to the registration's importers if the guard run outgrows it.
test("the generic host typechecks with any one product removed from the registration", () => {
  const run = spawnSync(
    process.execPath,
    ["--max-old-space-size=8192", resolve(import.meta.dirname, "product-removed.ts")],
    { encoding: "utf8", maxBuffer: 1 << 24 },
  );
  expect(run.status, run.stderr).toBe(0);
  expect(
    JSON.parse(run.stdout.trim().split(/\r?\n/).at(-1) ?? "null"),
    "A generic host line reads what only one product supplies",
  ).toEqual([]);
}, 600_000);
