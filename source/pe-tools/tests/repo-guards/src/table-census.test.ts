/**
 * THE TABLE CENSUS (outside-interaction-r3 §1) — the guard at zero.
 *
 * Every `<table` in apps/web/src is the one primitive (`Table`, drawn by its body and header) or a
 * DOMAIN table on the list below. A DOMAIN table says so in its own code with a `DOMAIN` comment,
 * and its reason is written here; a listed file without its comment fails, and so does a listed
 * file with no table left (delete the entry). Files are read as latin1, never skipped as binary
 * (census R20, as in list-census).
 */
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vite-plus/test";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../../apps/web/src");
const PRIMITIVE = new Set([
  "components/master-table/table.tsx",
  "components/master-table/master-table-body.tsx",
  "components/master-table/master-table-header.tsx",
]);
const DOMAIN: Record<string, string> = {
  "param-tables/variants/variant-e/bod-lens.tsx":
    "a printed-sheet exhibit: the sheet's layout is the point",
  "param-tables/variants/variant-e/fom-lens.tsx":
    "a printed-sheet exhibit with merged header cells",
  "design-system/action-demo-catalogue.tsx": "a specimen page's plain seed index",
  // Re-checked (r3): it IS data, but `Table` is a focusable grid with an entry tab stop; a
  // pointer-events-none peek over the plan must take no focus at all.
  "runs/browser/zone-peek.tsx": "a transient, unfocusable floater laid over the drawing",
  "workbench/prose.tsx": "GFM tables in prose; the markdown renderer owns them",
};

const files = (dir: string, rel = ""): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = rel ? `${rel}/${entry.name}` : entry.name;
    if (entry.isDirectory())
      return entry.name === "node_modules" ? [] : files(join(dir, entry.name), path);
    return /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) ? [path] : [];
  });

it("table census: every <table> is the one Table or a named DOMAIN table", () => {
  const text = (rel: string) => readFileSync(join(ROOT, rel), "latin1");
  const tables = files(ROOT).filter((rel) => !PRIMITIVE.has(rel) && /<table\b/.test(text(rel)));
  const stray = tables.filter((rel) => !(rel in DOMAIN));
  const unsaid = tables.filter((rel) => rel in DOMAIN && !/\bDOMAIN\b/.test(text(rel)));
  const stale = Object.keys(DOMAIN).filter((rel) => !tables.includes(rel));
  console.info(`table census: ${tables.length} hand tables, ${stray.length} unlisted`);
  expect({ stray, unsaid, stale }).toEqual({ stray: [], unsaid: [], stale: [] });
});
