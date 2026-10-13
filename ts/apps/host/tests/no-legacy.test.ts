import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "vite-plus/test";

// Owner ruling 2026-10-13: no legacy support. Shipped code never converts, moves or backs up a
// user's files to accept an old shape; the strict reader refuses it and names what to fix.
const trees = ["../src", "../../../packages/mcps/src"].map((at) => join(import.meta.dirname, at));
const files = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? files(join(dir, e.name)) : /\.tsx?$/.test(e.name) ? [join(dir, e.name)] : [],
  );

test("no shipped host or Pea code backs up or migrates user state", () => {
  const legacy = /\.backups|migratePodManifests|contribution-migration|\.v3\.json/;
  expect(trees.flatMap(files).filter((file) => legacy.test(readFileSync(file, "utf8")))).toEqual(
    [],
  );
});
