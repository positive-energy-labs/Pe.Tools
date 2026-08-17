/**
 * =============================================================================================
 * THE DESIGN GUARD — the enforcement lever of the one-system design sweep.
 * =============================================================================================
 *
 * This test IS the lint. The web app has no CI; `vp test` runs in the `ready` lane, so the
 * token discipline that held by review during the sweep now holds by assertion. It discharges
 * SHIMS.md entry 8 and encodes the DESIGN-LANG-HANDOFF §1 census gates that were driven to
 * zero (DESIGN-SWEEP.md, CLOSED 2026-08-16). It walks src/**\/*.{ts,tsx,css} once with plain
 * regexes — no dependencies, no AST.
 *
 * ── HARD ZERO (any occurrence fails) ────────────────────────────────────────────────────────
 *  1. dead-shim tokens   var(--st-* --act-* --cat-* --pe-blue* --pe-green --paper* --mist
 *                        --basalt --slate --lens-ink-2 --clay* --kiln --lichen --fail --user*
 *                        --pea-tint --pea-line --line-soft). The GROUND FLIP ruling: the alias
 *                        shim in styles.css reads ZERO lines and never grows one back — the
 *                        old vocabulary is deleted, so consuming it is consuming nothing.
 *  2. bare hairlines     var(--line) / var(--line-2). The canon hairlines are --r-line /
 *                        --r-line-2 (design-lang.css); the bare names died with the Lens
 *                        vocabulary. (The regex is literal, so var(--r-line) never matches.)
 *  3. tele classes       tele / tele-label / section-label as class words. The TYPE TIERS
 *                        ruling (TYPE-COPY-CENSUS RULED addendum): tier x face x case replaced
 *                        the tele bundles, deleted 2026-08-16. Comments are stripped first;
 *                        lang's `dl-section-label` is a different word and stays legal.
 *  4. hex literals       #rrggbb / #rrggbbaa outside design-lang.css. THE LAW in the canon
 *                        header: "no component, no route, and no CSS file downstream may name
 *                        a colour literal" — a colour is a one-line edit in design-lang.css.
 *  5. sub-10px type      text-[Npx] with N < 10. The 10px floor from the type-tier ruling
 *                        (ops enforced it on itself; the flagship pass finished the job).
 *
 * ── RATCHET (count may only fall; baselines in design-guard.baseline.json) ─────────────────
 *  textPx           any text-[Npx]: off-tier type. The tier system (t-* classes) is the scale;
 *                   the remaining spends are exhibit chrome + a few audited sites.
 *  rawButton        <button> outside components/ui + components/lang: verbs come from
 *                   lang/Verb (SHIMS entry 1); the tail is non-verb machinery.
 *  uiButtonImports  import sites of ui/button — SHIMS entry 1's still-open half; each route
 *                   pass that migrates a consumer lowers this until the file is deleted.
 *  dashed           border-dashed / stroke-dasharray / border-style: dashed outside
 *                   components/lang + design-lang.css. R13b: every broken-edge mechanism
 *                   occupies the SAME slot and means SEAM. The baseline covers the audited
 *                   deliberate spends (exhibit chrome, drawing-set's seam, atlas's legend).
 *  longTitle        title= props over 240 characters — the hover-shadow-doc ratchet from fit
 *                   review B·5: prose moved out of sight instead of deleted. May only shrink.
 *
 *  A count ABOVE its baseline fails with the offending files. A count BELOW its baseline also
 *  fails — asking you to lower the baseline — because a ratchet that can silently slacken is
 *  not a ratchet. Update src/design-guard.baseline.json in the same commit as the win.
 * =============================================================================================
 */
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vite-plus/test";

// ── the walk ─────────────────────────────────────────────────────────────────────────────────

const ROOT = dirname(fileURLToPath(import.meta.url)); // …/apps/web/src
const SELF = "design-guard.test.ts";
const SKIP_DIRS = new Set(["node_modules", "src"]); // src/src is a stray vite artifact
const SKIP_FILES = new Set(["routeTree.gen.ts", SELF]);

type Entry = { rel: string; text: string };

const collect = (dir: string, relBase: string, out: Entry[]): Entry[] => {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const rel = relBase === "" ? e.name : `${relBase}/${e.name}`;
    if (e.isDirectory()) {
      if (!SKIP_DIRS.has(e.name)) collect(join(dir, e.name), rel, out);
      continue;
    }
    if (SKIP_FILES.has(e.name)) continue;
    if (!/\.(?:tsx?|css)$/.test(e.name)) continue;
    out.push({ rel, text: readFileSync(join(dir, e.name), "utf8") });
  }
  return out;
};

const FILES: Entry[] = collect(ROOT, "", []);

const lineOf = (text: string, index: number): number => text.slice(0, index).split("\n").length;

type Offence = { rel: string; line: number; match: string };

const scan = (files: Entry[], re: RegExp): Offence[] => {
  const out: Offence[] = [];
  for (const f of files) {
    for (const m of f.text.matchAll(re)) {
      out.push({ rel: f.rel, line: lineOf(f.text, m.index), match: m[0] });
    }
  }
  return out;
};

const report = (offences: Offence[]): string =>
  offences
    .slice(0, 40)
    .map((o) => `  ${o.rel}:${o.line}  ${JSON.stringify(o.match)}`)
    .join("\n") + (offences.length > 40 ? `\n  … +${offences.length - 40} more` : "");

/** Blank out comments, preserving newlines so reported line numbers stay true. */
const stripComments = (text: string): string =>
  text
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
    .replace(/(^|[^:])\/\/[^\n]*/gm, (m, pre: string) => pre + " ".repeat(m.length - pre.length));

// ── hard zeros ───────────────────────────────────────────────────────────────────────────────

describe("design guard — hard zeros", () => {
  it("no dead shim token is consumed (the alias shim reads zero lines, forever)", () => {
    const re =
      /var\(--(?:st-|act-|cat-|pe-blue|pe-green|paper|mist|basalt|slate|lens-ink-2|clay|kiln|lichen|fail|user|pea-tint|pea-line|line-soft)/g;
    const offences = scan(FILES, re);
    expect(
      offences.length,
      `Dead shim tokens consumed — these were deleted at zero consumers; use the --r-* canon (design-lang.css):\n${report(offences)}`,
    ).toBe(0);
  });

  it("no bare var(--line) / var(--line-2) — the canon hairlines are --r-line / --r-line-2", () => {
    const re = /var\(--line(?:-2)?\s*[,)]/g;
    const offences = scan(FILES, re);
    expect(
      offences.length,
      `Bare hairline tokens — use var(--r-line) / var(--r-line-2):\n${report(offences)}`,
    ).toBe(0);
  });

  it("no tele / tele-label / section-label class words (type tiers replaced the bundles)", () => {
    const re = /(?<![-\w])(?:tele-label|section-label|tele)(?![-\w])/g;
    const offences: Offence[] = [];
    for (const f of FILES) {
      const stripped = stripComments(f.text);
      for (const m of stripped.matchAll(re)) {
        offences.push({ rel: f.rel, line: lineOf(stripped, m.index), match: m[0] });
      }
    }
    expect(
      offences.length,
      `Deleted tele bundle classes referenced — use the tier system (t-* / face-* / dl-section-label):\n${report(offences)}`,
    ).toBe(0);
  });

  it("no hex colour literal outside design-lang.css (a colour is a one-line edit there)", () => {
    const re = /#[0-9a-fA-F]{6}(?:[0-9a-fA-F]{2})?\b/g;
    const offences = scan(
      FILES.filter((f) => f.rel !== "design-lang.css"),
      re,
    );
    expect(
      offences.length,
      `Colour literals outside the canon — name a --r-* / --viz-* role instead:\n${report(offences)}`,
    ).toBe(0);
  });

  it("no sub-10px type (the 10px floor)", () => {
    const re = /text-\[[0-9]px\]/g;
    const offences = scan(FILES, re);
    expect(offences.length, `Type below the 10px floor:\n${report(offences)}`).toBe(0);
  });
});

// ── ratchets ─────────────────────────────────────────────────────────────────────────────────

type Baseline = Record<string, number>;
const BASELINE: Baseline = JSON.parse(
  readFileSync(join(ROOT, "design-guard.baseline.json"), "utf8"),
);

const isTsx = (f: Entry) => f.rel.endsWith(".tsx");
const inUiOrLang = (f: Entry) =>
  f.rel.startsWith("components/ui/") || f.rel.startsWith("components/lang/");

const ratchet = (name: string, offences: Offence[]) => {
  const base = BASELINE[name];
  expect(base, `Baseline "${name}" missing from design-guard.baseline.json`).toBeTypeOf("number");
  const count = offences.length;
  if (count > base) {
    const byFile = new Map<string, number>();
    for (const o of offences) byFile.set(o.rel, (byFile.get(o.rel) ?? 0) + 1);
    const files = [...byFile.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([rel, n]) => `  ${rel}: ${n}`)
      .join("\n");
    expect.fail(
      `RATCHET "${name}" grew: ${count} > baseline ${base}. The count may only fall. Offenders:\n${files}`,
    );
  }
  if (count < base) {
    expect.fail(
      `RATCHET "${name}" fell: ${count} < baseline ${base}. Good — lock it in: lower "${name}" to ${count} in src/design-guard.baseline.json (same commit).`,
    );
  }
};

describe("design guard — ratchets (baselines may only fall)", () => {
  it("textPx — arbitrary text-[Npx] off the tier ladder", () => {
    ratchet("textPx", scan(FILES, /text-\[\d+px\]/g));
  });

  it("rawButton — <button> outside components/ui + components/lang", () => {
    ratchet(
      "rawButton",
      scan(
        FILES.filter((f) => isTsx(f) && !inUiOrLang(f)),
        /<button\b/g,
      ),
    );
  });

  it("uiButtonImports — SHIMS entry 1's open tail; falls to 0 when ui/button dies", () => {
    ratchet("uiButtonImports", scan(FILES, /from\s+["'][^"']*ui\/button["']/g));
  });

  it("dashed — broken-edge mechanisms outside lang (R13b: dashed means SEAM, one slot)", () => {
    ratchet(
      "dashed",
      scan(
        FILES.filter((f) => !inUiOrLang(f) && f.rel !== "design-lang.css"),
        /border-dashed|stroke-dasharray|border-style:\s*dashed/g,
      ),
    );
  });

  it("longTitle — title= props over 240 chars (the hover shadow-doc, fit review B·5)", () => {
    const offences: Offence[] = [];
    const re = /title=(?:"([^"]*)"|\{\s*(?:"([^"]*)"|'([^']*)'|`([^`]*)`)\s*\})/gs;
    for (const f of FILES.filter(isTsx)) {
      for (const m of f.text.matchAll(re)) {
        const s = m[1] ?? m[2] ?? m[3] ?? m[4] ?? "";
        if (s.length > 240) {
          offences.push({
            rel: f.rel,
            line: lineOf(f.text, m.index),
            match: `title len=${s.length}`,
          });
        }
      }
    }
    ratchet("longTitle", offences);
  });
});
