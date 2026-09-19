/**
 * THE LIST CENSUS (ix-list, rulings-1600 §5d) — the guard at zero.
 *
 * Tier 1 counts the old list components' sites in apps/web/src with the census rule
 * (`ix-list-census.md`, "Old-component definition"): old kit imports, list roles written as JSX,
 * native select/datalist, the thread row recipe, and exports of the old names. The three files of
 * the one primitive are the only allowlisted paths.
 *
 * Tier 2 fails a hand-rolled list: a `.map(` whose RETURNED element is a `<button>`, an `<a>`, the
 * kit's `<Press>`, or a `<div onClick>`, and whose opening tag carries a picked state
 * (`aria-selected|pressed|current`, `data-selected|active`, a `…selected ?` / `…active ?` ternary,
 * or `? "selected"`). Outside `components/lang/`, only files named in TOGGLES (each with its
 * reason) may do that; any other hit is a list to move onto `List`, or a `Switcher` for a
 * segmented one-of-N. The wave-4 toggles (runs header, feedback tray, block-markdown drop target,
 * zone card, ledger dock's A/B cell, plan-dock and atlas key/stats) are single toggles outside any
 * `.map`, so they never trip and need no entry; the popovers harness moved onto `Switcher`.
 *
 * WHAT TIER 2 CANNOT SEE (read these by eye):
 * - selection kept only in a closure or a className helper, with no attribute or ternary in the
 *   returned tag (`className={rowClass(item)}`, `onClick={() => pick(item)}` alone);
 * - a picked state under another word: `isFocused ?`, `pinned ?`, `current === id ?`, `&&` classes
 *   (grounded-doc/view/images-pane.tsx's image list reads `isFocused ? "focused"` today);
 * - a returned element that is not the clickable one: `<li><button aria-pressed>`, a fragment, or
 *   another kit component (`<Row>` outside lang, a card) wrapping the click;
 * - rows built by `for` loops, `Array.from`, `flatMap`, or a helper that returns the JSX;
 * - a `.map` whose block body returns its element more than ~2000 characters after the arrow.
 *
 * Files are read as bytes, never skipped as "binary" (a NUL-bearing source was silently dropped by
 * plain rg — census R20).
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

/** Tier 2's allowlist: toggles, not lists (ix-list-result wave 4, "census-excluded toggles"). */
const TOGGLES: Record<string, string> = {};

const PICKED =
  /aria-(?:selected|pressed|current)=|data-(?:selected|active)=|\w*(?:selected|active)\s*\?(?![.?])|\?\s*"selected"/i;

/** The opening tag starting at `at` (`<name …>`), braces and quotes balanced: JSX props hold `=>`. */
function openingTag(text: string, at: number): string {
  let depth = 0;
  let quote = "";
  for (let i = at + 1; i < text.length; i++) {
    const c = text[i]!;
    if (quote) {
      if (c === quote && text[i - 1] !== "\\") quote = "";
    } else if (c === '"' || c === "'" || c === "`") quote = c;
    else if (c === "{") depth++;
    else if (c === "}") depth--;
    else if (c === ">" && depth === 0) return text.slice(at, i + 1);
  }
  return text.slice(at);
}

/** Tier 2 hits in one file, as `line: <tag>`. */
function tier2(text: string): string[] {
  const hits: string[] = [];
  for (const arrow of text.matchAll(/\.map\(\s*(?:\([^)]*\)|\w+)\s*=>/g)) {
    const after = text.slice(arrow.index + arrow[0].length, arrow.index + arrow[0].length + 2000);
    const returned =
      /^\s*(?:\(\s*)?<(\w+)/.exec(after) ?? /^\s*\{[\s\S]*?\breturn\s*(?:\(\s*)?<(\w+)/.exec(after);
    const tag = returned?.[1];
    if (tag !== "button" && tag !== "a" && tag !== "div" && tag !== "Press") continue;
    const open = openingTag(after, returned!.index + returned![0].length - tag.length - 1);
    if (tag === "div" && !/\bonClick=/.test(open)) continue;
    if (PICKED.test(open)) hits.push(`${text.slice(0, arrow.index).split("\n").length}: <${tag}>`);
  }
  return hits;
}

const files = (dir: string, rel = ""): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = rel ? `${rel}/${entry.name}` : entry.name;
    if (entry.isDirectory())
      return entry.name === "node_modules" ? [] : files(join(dir, entry.name), path);
    return /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) ? [path] : [];
  });

// latin1 keeps every byte, NULs included: nothing is ever skipped as binary.
const text = (rel: string) => readFileSync(join(ROOT, rel), "latin1");

it("list census: no old list component site outside the one primitive", () => {
  const sites = files(ROOT).filter((rel) => !ALLOWED.has(rel) && OLD.test(text(rel)));
  console.info(`list census: ${sites.length} old-component files\n  ${sites.join("\n  ")}`);
  // The census at a7e6988 counted 33; the cutover took it to zero.
  expect(sites).toEqual([]);
});

it("list census tier 2: no hand-rolled selectable .map rows outside lang and the named toggles", () => {
  const found = files(ROOT)
    .filter((rel) => !rel.startsWith("components/lang/"))
    .map((rel) => [rel, tier2(text(rel))] as const)
    .filter(([, hits]) => hits.length > 0);
  const rows = found
    .filter(([rel]) => !(rel in TOGGLES))
    .flatMap(([rel, hits]) => hits.map((hit) => `${rel}:${hit}`));
  const stale = Object.keys(TOGGLES).filter((rel) => !found.some(([hit]) => hit === rel));
  console.info(`list census tier 2: ${rows.length} rows\n  ${rows.join("\n  ")}`);
  expect({ rows, stale }).toEqual({ rows: [], stale: [] });
});
