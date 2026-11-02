import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vite-plus/test";
import { root } from "./unification-2-census.ts";

// S8: mount.tsx is the route door. Every noun lives in a `./mount-<noun>` seam beside it, so a new
// noun has nowhere to land in the door: it may import and re-export only its seams, under a cap.
const door = readFileSync(join(root, "ts/apps/web/src/shell/mount.tsx"), "utf8");
const MAX_LINES = 80;

it(`shell/mount.tsx stays under ${MAX_LINES} lines`, () => {
  expect(door.split("\n").length).toBeLessThanOrEqual(MAX_LINES);
});

it("shell/mount.tsx imports and re-exports only its seams", () => {
  const specifiers = [...door.matchAll(/\bfrom\s+["']([^"']+)["']/g)].map((m) => m[1]!);
  expect(specifiers.length).toBeGreaterThan(0);
  // `import type` from contracts carries no code, so it cannot smuggle a noun in.
  const typeOnly = new Set(
    [...door.matchAll(/^import type [^;]+ from\s+["']([^"']+)["']/gm)].map((m) => m[1]!),
  );
  const offenders = specifiers.filter((s) => !/^\.\/mount-[a-z]+$/.test(s) && !typeOnly.has(s));
  expect(offenders, "Move the code into a ./mount-<noun> seam").toEqual([]);
  expect(door, "no dynamic import or require in the door").not.toMatch(/\bimport\(|\brequire\(/);
});
