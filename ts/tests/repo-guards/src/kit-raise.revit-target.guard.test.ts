// Text census cannot prove that every id-bearing UI node is targeted or that its scope is correct.
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vite-plus/test";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
// These two web adapters own menu dispatch and parsing; kit owns declarations.
const OWNERS = new Set([
  "apps/web/src/revit/element-menu.tsx",
  "apps/web/src/revit/element-target.ts",
]);
const files = (dir: string, rel = ""): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = rel ? `${rel}/${entry.name}` : entry.name;
    if (entry.isDirectory())
      return ["node_modules", "dist", ".output"].includes(entry.name)
        ? []
        : files(join(dir, entry.name), path);
    return /\.tsx?$/.test(entry.name) ? [path] : [];
  });

it("Revit scopes and target attributes belong to kit, not hand-wired call sites", () => {
  const stray = files(ROOT).filter((rel) => {
    if (rel.startsWith("packages/kit/") || OWNERS.has(rel)) return false;
    const source = readFileSync(join(ROOT, rel), "latin1");
    return (
      /\brevitScope\s*\(|\bdata-revit-ids\s*=/.test(source) ||
      /<[^>]*className="contents"[^>]*\{\.\.\.revit|<[^>]*\{\.\.\.revit[^>]*className="contents"/s.test(
        source,
      )
    );
  });
  expect(stray).toEqual([]);
});
