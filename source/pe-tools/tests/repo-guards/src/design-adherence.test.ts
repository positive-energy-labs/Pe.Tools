/**
 * =============================================================================================
 * THE ADHERENCE CENSUS — what the design guard cannot see.
 * =============================================================================================
 *
 * `design-guard.test.ts` holds token discipline at hard zero: one owner per value. It proves
 * nothing about whether a surface USES the components the language built. This file counts the
 * places a route rolled its own where a canon primitive exists, per feature directory, and holds
 * every count as a non-increasing ratchet against `design-adherence.baseline.json`.
 *
 * A ratchet, not a zero, on purpose: these are adoption debts, and the ledger owns which ones are
 * ruled (SURFACE-PHILOSOPHY §6 "extend the shared primitive; do not fork it"). A count that goes
 * UP fails; a count that goes down asks you to lower the baseline in the same commit, so the
 * baseline is the honest floor and never a ceiling to grow into.
 *
 * ── METRICS ─────────────────────────────────────────────────────────────────────────────────
 *  rawTable         `<table` outside components/master-table. The canon table is MasterTable;
 *                   every other table is a migration target (ledger, Primitives 2026-08-15).
 *  localChrome      a route-local Section / SectionHead / SectionLabel / Cap function.
 *                   `lang/section.tsx` exists; three hand-rolled copies were the most visible
 *                   thing lang was missing (ledger, Component repairs).
 *  hostBelowRoute   `callHostRpc` / `fetch(` imported or called outside routes/, host/, and a
 *                   feature's own `host.ts` / `store.ts`. §7: "nothing below the route reaches
 *                   the host".
 *  escHandler       a hand-rolled `key === "Escape"` branch. Three guard lists disagreed
 *                   (ledger, Duplication to collapse); one owner is owed.
 *  opacityDim       `opacity-1..99` utilities and `opacity:` styles. Ruled 2026-09-01: opacity
 *                   is legal only as the 0<->100 visibility pair of a transition (pane halo,
 *                   shortcut card); any value between is de-emphasis and counts.
 *  longTitle        `title=` over 120 chars. The guard fails at 240; the bimodal census said
 *                   two primitives were wearing one attribute above ~120 (Tried & rejected).
 *  busyState        a hand-rolled `useState` named busy/running/pending. `runVerb` is the one
 *                   verb bracket (ledger 2026-08-27); `/instances` and `/parameter-links`
 *                   still hand-roll.
 *  inlineColor      `style={{ … color|borderColor|backgroundColor: …}}` in TSX. Data-driven
 *                   colour is legal (viz), so this is a census, not a fault — but a rising
 *                   number means product code is painting instead of wearing a role.
 *  rawMeaningColor  a meaning-band utility (`text-alarm`, `bg-pea`, `border-caution`, …) spent
 *                   outside components/. Colour is a claim about meaning; the language makes
 *                   the claim through FactChip / Verb / OutcomeLine / StateCell. A route
 *                   spending the hue directly is a component the language is missing, or a
 *                   consumer that skipped one.
 *  dlLeak           a `dl-*` grammar class named outside components/lang. The grammar's CSS is
 *                   private to its components; a leak is a fork in utility clothing.
 *  fatRoute         a routes/*.tsx over FAT_ROUTE_LINES. §7: the route owns the world and the
 *                   host calls and renders a view; a fat route is carrying the view or the store.
 *
 * Run with PE_ADHERENCE_WRITE=1 to rewrite the baseline from the current tree, then read the
 * diff: every lowered number is a repair you can name in the commit.
 *
 * `vp run @pe/repo-guards#test -- --reporter=verbose` prints the census table on every run.
 * =============================================================================================
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vite-plus/test";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "../../../apps/web/src");
const BASELINE_PATH = join(HERE, "design-adherence.baseline.json");
const SKIP_DIRS = new Set(["node_modules", "src"]);
const SKIP_FILES = new Set(["routeTree.gen.ts"]);

type Entry = { rel: string; text: string };
const collect = (dir: string, relBase: string, out: Entry[]): Entry[] => {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const rel = relBase === "" ? e.name : `${relBase}/${e.name}`;
    if (e.isDirectory()) {
      if (!SKIP_DIRS.has(e.name)) collect(join(dir, e.name), rel, out);
      continue;
    }
    if (SKIP_FILES.has(e.name) || !/\.tsx?$/.test(e.name) || /\.test\.tsx?$/.test(e.name)) continue;
    out.push({ rel, text: stripComments(readFileSync(join(dir, e.name), "utf8")) });
  }
  return out;
};

const stripComments = (text: string): string =>
  text
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
    .replace(/(^|[^:])\/\/[^\n]*/gm, (m, pre: string) => pre + " ".repeat(m.length - pre.length));

const FILES = collect(ROOT, "", []);
const lineOf = (text: string, i: number) => text.slice(0, i).split("\n").length;
const area = (rel: string) => (rel.includes("/") ? rel.split("/")[0] : "(root)");
/** A feature's own host/store files are the route's hands; the rule is about everything below. */
const ownsHost = (rel: string) =>
  /^(?:routes|host|state|integrations)\//.test(rel) ||
  /\/(?:host|store|queries|world)\.tsx?$/.test(rel);

type Metric = { name: string; re: RegExp; where?: (rel: string) => boolean; min?: number };
const OPACITY_DIM = /(?<![-\w])opacity-(?:[1-9]\d?(?!\d)|\[[^\]]+\])|\bopacity:\s*[\d.]/g;
const INLINE_COLOR =
  /\b(?:color|borderColor|backgroundColor|background|fill|stroke):\s*(?=\S)(?:"(?!(?:currentColor|none|transparent|inherit)"\s*[,}])[^,}]+|'(?!(?:currentColor|none|transparent|inherit)'\s*[,}])[^,}]+|(?!["'])(?!(?:currentColor|none|transparent|inherit)\s*[,}])[^,}]+)/g;

const METRICS: Metric[] = [
  { name: "rawTable", re: /<table\b/g, where: (r) => !r.startsWith("components/master-table/") },
  {
    name: "localChrome",
    re: /\bfunction (?:Section|SectionHead|SectionLabel|Cap)\s*\(/g,
    where: (r) => !r.startsWith("components/lang/"),
  },
  { name: "hostBelowRoute", re: /\b(?:callHostRpc|fetch)\(/g, where: (r) => !ownsHost(r) },
  { name: "escHandler", re: /key\s*===\s*["']Escape["']/g },
  { name: "opacityDim", re: OPACITY_DIM },
  { name: "longTitle", re: /title=(?:"[^"]{120,}"|\{`[^`]{120,}`\})/g },
  { name: "busyState", re: /\[(?:busy|running|pending|saving)\w*,\s*set\w+\]\s*=\s*useState/g },
  {
    name: "inlineColor",
    re: INLINE_COLOR,
    where: (r) => r.endsWith(".tsx"),
  },
  {
    name: "rawMeaningColor",
    re: /(?<![-\w])(?:bg|text|border|fill|stroke|ring|outline)-(?:pea|pea-ink|alarm|caution|done|commit|nav)(?![-\w])/g,
    where: (r) => !r.startsWith("components/"),
  },
  { name: "dlLeak", re: /(?<![-\w])dl-[a-z-]+/g, where: (r) => !r.startsWith("components/lang/") },
  { name: "fatRoute", re: /^/g, where: () => false },
];
/** §7 route anatomy: the route owns the world and the host calls, the view renders. A route
 *  file past this many lines is carrying a view or a store. `/family` is 44 lines, `/families`
 *  38; the design-system exhibits are the documented exception and are counted anyway. */
const FAT_ROUTE_LINES = 150;

type Offence = { rel: string; line: number; match: string };
type Census = Record<
  string,
  { total: number; byArea: Record<string, number>; offences: Offence[] }
>;

const census = (): Census => {
  const out: Census = {};
  for (const m of METRICS) {
    const offences: Offence[] = [];
    if (m.name === "fatRoute") {
      for (const f of FILES) {
        const lines = f.text.split("\n").length;
        if (f.rel.startsWith("routes/") && lines > FAT_ROUTE_LINES)
          offences.push({ rel: f.rel, line: lines, match: `${lines} lines` });
      }
    }
    for (const f of FILES) {
      if (m.where && !m.where(f.rel)) continue;
      // inlineColor only counts inside style objects; the other metrics scan whole files.
      const text =
        m.name === "inlineColor"
          ? onlyStyleObjects(f.text)
          : m.name === "opacityDim"
            ? stripKeyframes(f.text)
            : f.text;
      for (const hit of text.matchAll(m.re)) {
        offences.push({ rel: f.rel, line: lineOf(text, hit.index), match: hit[0].slice(0, 80) });
      }
    }
    const byArea: Record<string, number> = {};
    for (const o of offences) byArea[area(o.rel)] = (byArea[area(o.rel)] ?? 0) + 1;
    out[m.name] = { total: offences.length, byArea, offences };
  }
  return out;
};

/** Keep only `style={{ … }}` bodies, blanking everything else and preserving newlines. */
const onlyStyleObjects = (text: string): string => {
  let out = "";
  let i = 0;
  const re = /style=\{\{/g;
  for (const m of text.matchAll(re)) {
    const start = m.index + m[0].length;
    let depth = 2;
    let j = start;
    while (j < text.length && depth > 0) {
      if (text[j] === "{") depth++;
      else if (text[j] === "}") depth--;
      j++;
    }
    out += text.slice(i, start).replace(/[^\n]/g, " ") + text.slice(start, j);
    i = j;
  }
  return out + text.slice(i).replace(/[^\n]/g, " ");
};

/** Blank keyframe bodies while preserving line numbers for the opacity census. */
const stripKeyframes = (text: string): string => {
  let out = text;
  for (const match of text.matchAll(/@keyframes\s+[\w-]+\s*\{/g)) {
    let depth = 1;
    let end = match.index + match[0].length;
    while (end < text.length && depth > 0) {
      if (text[end] === "{") depth++;
      else if (text[end] === "}") depth--;
      end++;
    }
    out =
      out.slice(0, match.index) +
      out.slice(match.index, end).replace(/[^\n]/g, " ") +
      out.slice(end);
  }
  return out;
};

type Baseline = Record<string, { total: number; byArea: Record<string, number> }>;

const table = (c: Census): string => {
  const areas = [...new Set(Object.values(c).flatMap((m) => Object.keys(m.byArea)))].sort();
  const head = ["metric", "total", ...areas].join(" | ");
  const rows = Object.entries(c).map(([name, m]) =>
    [name, m.total, ...areas.map((a) => m.byArea[a] ?? 0)].join(" | "),
  );
  return [head, ...rows].join("\n");
};

describe("design adherence — component adoption ratchet", () => {
  const current = census();
  const slim: Baseline = Object.fromEntries(
    Object.entries(current).map(([k, v]) => [k, { total: v.total, byArea: v.byArea }]),
  );

  if (process.env.PE_ADHERENCE_WRITE || !existsSync(BASELINE_PATH)) {
    writeFileSync(BASELINE_PATH, JSON.stringify(slim, null, 2) + "\n");
  }
  const baseline = JSON.parse(readFileSync(BASELINE_PATH, "utf8")) as Baseline;

  it("prints the census", () => {
    console.log("\n" + table(current) + "\n");
    expect(Object.keys(current)).toEqual(METRICS.map((m) => m.name));
  });

  it("inlineColor excludes quoted and unquoted non-colors without hiding authored paint", () => {
    const fixture = onlyStyleObjects(`
      <div style={{ color: "transparent", borderColor: 'inherit', fill: none }} />
      <div style={{ color: token("ink") }} />
    `);
    expect([...fixture.matchAll(INLINE_COLOR)].map((match) => match[0])).toEqual([
      'color: token("ink") ',
    ]);
  });

  it("opacityDim ignores keyframes without hiding UI dimming", () => {
    const fixture = stripKeyframes(
      "opacity-50 opacity-0 opacity-100; @keyframes pulse{0%,100%{opacity:.15}50%{opacity:1}} opacity: 0.5",
    );
    expect([...fixture.matchAll(OPACITY_DIM)].map((match) => match[0])).toEqual([
      "opacity-50",
      "opacity: 0",
    ]);
  });

  for (const m of METRICS) {
    it(`${m.name} never rises above the baseline`, () => {
      const was = baseline[m.name]?.total ?? 0;
      const now = current[m.name].total;
      const worst = current[m.name].offences
        .slice(0, 40)
        .map((o) => `  ${o.rel}:${o.line}  ${JSON.stringify(o.match)}`)
        .join("\n");
      expect(now, `${m.name}: ${now} > baseline ${was}\n${worst}`).toBeLessThanOrEqual(was);
    });

    it(`${m.name} baseline is not stale (lower it when the count drops)`, () => {
      const was = baseline[m.name]?.total ?? 0;
      const now = current[m.name].total;
      expect(
        now,
        `${m.name} dropped to ${now}; baseline still says ${was}. Run PE_ADHERENCE_WRITE=1.`,
      ).toBe(was);
    });
  }
});
