/**
 * =============================================================================================
 * THE DESIGN GUARD — the enforcement lever of the one-system design sweep.
 * =============================================================================================
 *
 * This test IS the lint. `@pe/repo-guards#test` runs in the `ready` lane, so the
 * token discipline that held by review during the sweep now holds by assertion. It encodes the
 * census gates driven to zero in the one-system design sweep (closed 2026-08-16; see the
 * Enforcement lines in docs/features/design-system/LEDGER.md). It walks src/**\/*.{ts,tsx,css} once with plain
 * regexes — no dependencies, no AST.
 *
 * ── HARD ZERO (any occurrence fails) ────────────────────────────────────────────────────────
 *  1. dead-shim tokens   var(--st-* --act-* --cat-* --pe-blue* --pe-green --paper* --mist
 *                        --basalt --slate --lens-ink-2 --clay* --kiln --lichen --fail --user*
 *                        --pea-tint --pea-line --line-soft). The GROUND FLIP ruling: the alias
 *                        shim in styles.css reads ZERO lines and never grows one back — the
 *                        old vocabulary is deleted, so consuming it is consuming nothing.
 *  2. bare hairlines     var(--line) / var(--line-2). The canon hairlines are --pe-line /
 *                        --pe-line-2 (base.css); the bare names died with the Lens
 *                        vocabulary.
 *  3. tele classes       tele / tele-label / section-label as class words. The TYPE TIERS
 *                        ruling: tier x face x case replaced
 *                        the tele bundles, deleted 2026-08-16. Comments are stripped first;
 *                        lang's `dl-section-label` is a different word and stays legal.
 *  4. hex literals       #rrggbb / #rrggbbaa outside base.css. THE LAW in the canon
 *                        header: "no component, no route, and no CSS file downstream may name
 *                        a colour literal" — a colour is a one-line edit in base.css.
 *  5. sub-10px type      text-[Npx] with N < 10. The 10px floor from the type-tier ruling
 *                        (ops enforced it on itself; the flagship pass finished the job).
 *  6. inline backgrounds  background: in TypeScript/TSX style objects. The shared veil uses
 *                        background-image, so a shorthand reset is forbidden; CSS declarations
 *                        remain legal.
 *
 * ── RATCHET (count may only fall; baselines in design-guard.baseline.json) ─────────────────
 *  rawTextSize      any raw text-[Npx] or named Tailwind text-size utility. The tier system
 *                   (t-* classes) is the scale; the remaining spends are non-exact tail sites.
 *  rawButton        <button> outside components/ui + components/lang: verbs come from
 *                   lang/Verb; the tail is non-verb machinery.
 *  uiButtonImports  import sites of ui/button — the still-open half; each route
 *                   pass that migrates a consumer lowers this until the file is deleted.
 *  dashed           border-dashed / stroke-dasharray / border-style: dashed outside
 *                   components/lang + design-lang.css. R13b: every broken-edge mechanism
 *                   occupies the SAME slot and means SEAM. The baseline covers the audited
 *                   deliberate spends (exhibit chrome, drawing-set's seam, atlas's legend).
 *  longTitle        title= props over 240 characters — the hover-shadow-doc ratchet from fit
 *                   review B·5: prose moved out of sight instead of deleted. May only shrink.
 *
 *  The walk covers every apps/web/src TypeScript, TSX, and CSS file, including prototype paths.
 *  Only the generated route tree is excluded; mounted prototypes remain maintained surface.
 *
 *  A count ABOVE its baseline fails with the offending files. A count BELOW its baseline also
 *  fails — asking you to lower the baseline — because a ratchet that can silently slacken is
 *  not a ratchet. Update src/design-guard.baseline.json in the same commit as the win.
 * =============================================================================================
 */
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vite-plus/test";

// ── the walk ─────────────────────────────────────────────────────────────────────────────────

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "../../../apps/web/src");
const SKIP_DIRS = new Set(["node_modules", "src"]); // src/src is a stray vite artifact
const SKIP_FILES = new Set(["routeTree.gen.ts"]);

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

describe("design guard â€” current token authority", () => {
  it("has no retired --r-* tokens", () => {
    const offences = scan(FILES, /--r-[\w-]+/g);
    expect(offences, report(offences)).toEqual([]);
  });

  it("has no shadcn semantic color vars or utilities", () => {
    const names =
      "background|foreground|primary|secondary|muted|accent|destructive|card|popover|border|input|ring|sidebar|chart-[1-5]";
    const re = new RegExp(
      `var\\(--(?:color-)?(?:${names})(?![-\\w])|["']--(?:color-)?(?:${names})(?![-\\w])["']\\s*:|(?:^|[,{;\\n])\\s*--(?:color-)?(?:${names})(?![-\\w])\\s*:|(?<![-\\w])(?:bg|text|border|divide|ring|outline|fill|stroke)-(?:${names})(?![-\\w])`,
      "g",
    );
    const offences = scan(FILES, re);
    expect(offences, report(offences)).toEqual([]);
  });

  it("has no arbitrary PE color utilities", () => {
    const re =
      /(?<![-\w])(?:bg|text|border(?:-[xytrbls])?|divide|ring|outline|fill|stroke|from|via|to)-\[[^\]]*var\(--pe-[^)]+\)[^\]]*\]/g;
    const offences = scan(FILES, re);
    expect(offences, report(offences)).toEqual([]);
  });

  it("reads runtime PE and viz vars only through lib/token.ts", () => {
    const code = FILES.filter((f) => /\.tsx?$/.test(f.rel) && f.rel !== "lib/token.ts").map(
      (f) => ({ ...f, text: stripComments(f.text) }),
    );
    const offences = scan(code, /var\(--(?:pe|viz)-/g);
    expect(offences, report(offences)).toEqual([]);
  });

  it("projects every type tier through shared raw size and line-height values", () => {
    const base = FILES.find((f) => f.rel === "base.css")?.text ?? "";
    const lang = FILES.find((f) => f.rel === "design-lang.css")?.text ?? "";
    for (const tier of ["caption", "label", "value", "prose", "title", "head", "display"]) {
      const block = new RegExp(
        `(?:\\.t-${tier}|@utility\\s+t-${tier})\\s*\\{(?=[^}]*font-size:\\s*var\\(--type-${tier}-size\\))(?=[^}]*line-height:\\s*var\\(--type-${tier}-line-height\\))[^}]*\\}`,
        "s",
      );
      expect(base, `base.css wiring for t-${tier}`).toMatch(block);
      expect(lang, `design-lang.css wiring for t-${tier}`).toMatch(block);
    }
  });
});

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

/** Blank out template literals so CSS-in-TS declarations do not look like inline style objects. */
const stripTemplateLiterals = (text: string): string =>
  text.replace(/`[\s\S]*?`/g, (m) => m.replace(/[^\n]/g, " "));

// ── hard zeros ───────────────────────────────────────────────────────────────────────────────

describe("design guard — carried debt ratchets", () => {
  it("no dead shim token is consumed (the alias shim reads zero lines, forever)", () => {
    const re =
      /var\(--(?:st-|act-|cat-|pe-blue|pe-green|paper|mist|basalt|slate|lens-ink-2|clay|kiln|lichen|fail|user|pea-tint|pea-line|line-soft)/g;
    const offences = scan(FILES, re);
    ratchet("deadShim", offences);
  });

  it("no bare var(--line) / var(--line-2) — the canon hairlines are --pe-line / --pe-line-2", () => {
    const re = /var\(--line(?:-2)?\s*[,)]/g;
    const offences = scan(FILES, re);
    ratchet("bareLine", offences);
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
    ratchet("tele", offences);
  });

  it("no hex colour literal outside base.css (a colour is a one-line edit there)", () => {
    const re = /(?<![\w#])#[0-9a-fA-F]{3}(?:[0-9a-fA-F]{3})?(?:[0-9a-fA-F]{2})?\b/g;
    const offences = scan(
      FILES.filter((f) => f.rel !== "base.css").map((f) => ({ ...f, text: stripComments(f.text) })),
      re,
    );
    ratchet("hex", offences);
  });

  it("no sub-10px type (the 10px floor)", () => {
    const re = /text-\[[0-9]px\]/g;
    const offences = scan(FILES, re);
    ratchet("sub10", offences);
  });

  it("no inline background shorthand in TypeScript/TSX", () => {
    const code = FILES.filter((f) => /\.tsx?$/.test(f.rel)).map((f) => ({
      ...f,
      text: stripTemplateLiterals(stripComments(f.text)),
    }));
    const offences = scan(code, /\bbackground\s*:/g);
    expect(offences, report(offences)).toEqual([]);
  });
});

// ── ratchets ─────────────────────────────────────────────────────────────────────────────────

type Baseline = Record<string, number>;
const BASELINE: Baseline = JSON.parse(
  readFileSync(join(HERE, "design-guard.baseline.json"), "utf8"),
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
  it("rawTextSize — arbitrary and named raw text-size utilities", () => {
    // Absolute units only. `text-[0.7rem]` (ADR 0004's named outlier, in `ui/badge`) survived the
    // px-only form of this gate; `em` stays legal because `text-[1em]` is an inheritance
    // instruction — `PROSE_CLASS` is composed at two different tiers by its two consumers.
    const re =
      /(?<![-\w])text-(?:\[(?:\d+(?:\.\d+)?|\.\d+)(?:px|rem)\]|xs|sm|base|lg|xl|\d+xl)(?![-\w])/g;
    ratchet("rawTextSize", scan(FILES, re));
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

  it("uiButtonImports — open tail; falls to 0 when ui/button dies", () => {
    ratchet("uiButtonImports", scan(FILES, /from\s+["'][^"']*ui\/button["']/g));
  });

  it("dashed — every broken line comes from a named role, never a raw pattern", () => {
    // Both representations: an edge (border/outline `dashed`) and a stroke (camelCase JSX attr,
    // kebab CSS declaration, or a serialized SVG string) whose value is not a `dash()` role.
    // Authority: base.css. Callers wear a `dash-*`/`seam-border` class or read `dash(role)`.
    const edge =
      /border-dashed|(?:\bborder(?:-(?:top|right|bottom|left|style)|Top|Right|Bottom|Left|Style)?|\boutline(?:-style|Style)?)\s*:\s*[^;\n]{0,40}\bdashed\b/g;
    const stroke = /stroke-?[Dd]asharray\s*[:=](?![^\n]{0,30}dash\()/g;
    const files = FILES.filter(
      (f) => !inUiOrLang(f) && f.rel !== "design-lang.css" && f.rel !== "base.css",
    ).map((f) => ({ ...f, text: stripComments(f.text) }));
    ratchet("dashed", [...scan(files, edge), ...scan(files, stroke)]);
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
