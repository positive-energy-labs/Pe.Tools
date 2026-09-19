/**
 * THE LIST CENSUS (ix-list, rulings-1600 §5d) — the guard at zero.
 *
 * Counts the old list components' sites in apps/web/src with the census rule (`ix-list-census.md`,
 * "Old-component definition"): old kit imports, list roles written as JSX, native select/datalist,
 * the thread row recipe, and exports of the old names. Files are read as bytes, never skipped as
 * "binary" (a NUL-bearing source was silently dropped by plain rg — census R20). The three files
 * of the one primitive are the only allowlisted paths.
 *
 * The cutover is done: the count is zero, and a returning old component fails the build. Tier 2
 * (hand-rolled selectable `.map` rows) is printed by proxy; it is read by eye, not failed.
 */
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vite-plus/test";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../../apps/web/src");
const ALLOWED = new Set([
  "components/lang/row.tsx",
  "components/lang/collection.ts",
  "components/lang/list-popup.tsx",
]);
const OLD =
  /from "(#\/components\/lang\/(pick-list|combobox|command)|(#\/route|\.)\/picker|cmdk|@base-ui\/react\/(combobox|select|menu|autocomplete))"|role="(listbox|option|menu|menuitem)"|<(datalist|select)[ >]|threadRowRecipe\(|export (function|const) (PickList|Picker|Combobox|Command|CellSelect|ThreadList|ThreadPalette)\b/;
const TIER2 = /\? "selected" : "rest"/;

const files = (dir: string, rel = ""): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = rel ? `${rel}/${entry.name}` : entry.name;
    if (entry.isDirectory())
      return entry.name === "node_modules" ? [] : files(join(dir, entry.name), path);
    return /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) ? [path] : [];
  });

it("list census: no old list component site outside the one primitive", () => {
  // latin1 keeps every byte, NULs included: nothing is ever skipped as binary.
  const text = (rel: string) => readFileSync(join(ROOT, rel), "latin1");
  const all = files(ROOT).filter((rel) => !ALLOWED.has(rel));
  const sites = all.filter((rel) => OLD.test(text(rel)));
  const tier2 = all.filter((rel) => TIER2.test(text(rel)));
  console.info(
    `list census: ${sites.length} old-component files; tier-2 proxy ${tier2.length}\n  ${sites.join("\n  ")}`,
  );
  // The census at a7e6988 counted 33; the cutover took it to zero.
  expect(sites).toEqual([]);
});
