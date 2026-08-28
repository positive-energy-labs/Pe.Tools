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
 * ── HARD ZERO (every category below must remain empty) ─────────────────────────────────────
 *  rawTextSize      any raw text-[Npx|Nrem] or named Tailwind text-size utility. The seven
 *                   tiers (t-* classes) are the scale; nothing else names a size.
 *  rawButton        <button> outside components/ui + components/lang. World actions are
 *                   lang/Verb, surface machinery is lang/Press.
 *  uiButtonImports  import sites of ui/button. The file is deleted; this stops it returning.
 *  dashed           any broken line outside components/lang + design-lang.css + base.css whose
 *                   value is not a named role. Broken lines carry THREE roles under ONE
 *                   authority — seam, reference, void, patterned in base.css. Callers wear a
 *                   dash-* / seam-border class or read dash(role).
 *  absoluteType      numeric font-size/fontSize, line-height/lineHeight, and font-weight/fontWeight
 *                   outside the foundation. Every UI value consumes a tier or weight variable;
 *                   SVG drawing geometry keeps its numeric fontSize presentation attributes.
 *  rawLeading       every Tailwind leading-* utility. Tier leading is authoritative.
 *  rawFace          font-mono, ui-monospace, and --font-pe-mono outside the foundation.
 *  longTitle        title= props over 240 characters. Long guidance belongs in visible HelpTip
 *                   content; instance facts may remain in title attributes.
 *
 *  The walk covers every apps/web/src TypeScript, TSX, and CSS file, including prototype paths.
 *  Only the generated route tree is excluded; mounted prototypes remain maintained surface.
 *
 *  Every category is a direct hard-zero assertion. Failures include the first 40 offending
 *  paths and source matches, so a new violation points at its repair site.
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

const collect = (dir: string, relBase: string, out: Entry[], match: RegExp): Entry[] => {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const rel = relBase === "" ? e.name : `${relBase}/${e.name}`;
    if (e.isDirectory()) {
      if (!SKIP_DIRS.has(e.name)) collect(join(dir, e.name), rel, out, match);
      continue;
    }
    if (SKIP_FILES.has(e.name)) continue;
    if (!match.test(e.name)) continue;
    out.push({ rel, text: readFileSync(join(dir, e.name), "utf8") });
  }
  return out;
};

const FILES: Entry[] = collect(ROOT, "", [], /\.(?:tsx?|css)$/);
/** Data files are scanned only for the dash-authority rule — see the JSON gate below. */
const JSON_FILES: Entry[] = collect(ROOT, "", [], /\.json$/);

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

  it("projects the shared weight variables through Tailwind", () => {
    const base = FILES.find((f) => f.rel === "base.css")?.text ?? "";
    const lang = FILES.find((f) => f.rel === "design-lang.css")?.text ?? "";
    for (const [name, value] of [
      ["regular", "400"],
      ["medium", "500"],
      ["strong", "600"],
      ["bold", "700"],
    ]) {
      expect(base, `base.css value for weight-${name}`).toContain(`--weight-${name}: ${value};`);
      const projection = name === "regular" ? "normal" : name === "strong" ? "semibold" : name;
      expect(lang, `design-lang.css projection for weight-${name}`).toContain(
        `--font-weight-${projection}: var(--weight-${name});`,
      );
    }
    expect(base, "base.css t-title weight").toContain("font-weight: var(--weight-strong);");
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

describe("design guard — maintained surface hard zeros", () => {
  it("no dead shim token is consumed (the alias shim reads zero lines, forever)", () => {
    const re =
      /var\(--(?:st-|act-|cat-|pe-blue|pe-green|paper|mist|basalt|slate|lens-ink-2|clay|kiln|lichen|fail|user|pea-tint|pea-line|line-soft)/g;
    const offences = scan(FILES, re);
    assertZero("deadShim", offences);
  });

  it("no bare var(--line) / var(--line-2) — the canon hairlines are --pe-line / --pe-line-2", () => {
    const re = /var\(--line(?:-2)?\s*[,)]/g;
    const offences = scan(FILES, re);
    assertZero("bareLine", offences);
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
    assertZero("tele", offences);
  });

  it("no hex colour literal outside base.css (a colour is a one-line edit there)", () => {
    const re = /(?<![\w#])#[0-9a-fA-F]{3}(?:[0-9a-fA-F]{3})?(?:[0-9a-fA-F]{2})?\b/g;
    const offences = scan(
      FILES.filter((f) => f.rel !== "base.css").map((f) => ({ ...f, text: stripComments(f.text) })),
      re,
    );
    assertZero("hex", offences);
  });

  it("no sub-10px type (the 10px floor)", () => {
    const re = /text-\[[0-9]px\]/g;
    const offences = scan(FILES, re);
    assertZero("sub10", offences);
  });

  it("no raw numeric dash pattern in maintained web JSON (roles only)", () => {
    // A data file may NAME a dash role; base.css is the only place that says what it looks like.
    // `runs/visual-law.json` carried `dash: [6, 4]` while the web surface had moved to
    // `--dash-reference`, so its Python co-consumer drew a different boundary than /runs did.
    // The law names `dashRole` now, and both surfaces resolve the number from base.css.
    const re = /"(?:dash|dasharray|strokeDasharray|dashPattern)"\s*:\s*(?:\[[^\]]*\]|"[^"]*")/g;
    const offences = scan(JSON_FILES, re);
    expect(offences, report(offences)).toEqual([]);
  });

  it("no inline background shorthand in TypeScript/TSX", () => {
    const code = FILES.filter((f) => /\.tsx?$/.test(f.rel)).map((f) => ({
      ...f,
      text: stripTemplateLiterals(stripComments(f.text)),
    }));
    const offences = scan(code, /\bbackground\s*:/g);
    expect(offences, report(offences)).toEqual([]);
  });

  it("no absolute type values outside base.css and design-lang.css", () => {
    const files = FILES.filter((f) => f.rel !== "base.css" && f.rel !== "design-lang.css").map(
      (f) => ({
        ...f,
        text: stripComments(f.text),
      }),
    );
    const re = /(?:font-size|fontSize)\s*[:=]\s*["']?(?:\d+(?:\.\d+)?|\.\d+)(?:px|rem)?["']?/g;
    assertZero("absoluteType", scan(files, re));
  });

  it("no raw leading utilities", () => {
    assertZero("rawLeading", scan(FILES, /(?<![-\w])leading-[\w[\].-]+/g));
  });

  it("no numeric line-height outside the foundation", () => {
    const files = FILES.filter((f) => f.rel !== "base.css" && f.rel !== "design-lang.css").map(
      (f) => ({
        ...f,
        text: stripComments(f.text),
      }),
    );
    const re =
      /(?:line-height|lineHeight)\s*[:=]\s*(?!calc\(1\.75rem\s*-\s*1px\))["']?(?:\d+(?:\.\d+)?|\.\d+)(?:px|rem)?["']?/g;
    assertZero("numericLineHeight", scan(files, re));
  });

  it("uses one face spelling outside the foundation", () => {
    const files = FILES.filter((f) => f.rel !== "base.css" && f.rel !== "design-lang.css").map(
      (f) => ({
        ...f,
        text: stripComments(f.text),
      }),
    );
    const re = /(?<![-\w])font-mono(?![-\w])|ui-monospace|--font-pe-mono/g;
    assertZero("rawFace", scan(files, re));
  });

  it("uses weight variables outside the foundation", () => {
    const files = FILES.filter((f) => f.rel !== "base.css" && f.rel !== "design-lang.css").map(
      (f) => ({
        ...f,
        text: stripComments(f.text),
      }),
    );
    const re =
      /(?:font-weight|fontWeight)\s*[:=]\s*(?:["']?\d+(?:\.\d+)?["']?|\{\s*\d+(?:\.\d+)?\s*\})/g;
    assertZero("numericWeight", scan(files, re));
  });
});

const isTsx = (f: Entry) => f.rel.endsWith(".tsx");
const inUiOrLang = (f: Entry) =>
  f.rel.startsWith("components/ui/") || f.rel.startsWith("components/lang/");

const assertZero = (name: string, offences: Offence[]) => {
  expect(
    offences,
    `HARD ZERO "${name}" found ${offences.length} offender(s):\n${report(offences)}`,
  ).toEqual([]);
};

describe("design guard — maintained surface hard zeros", () => {
  it("rawTextSize — arbitrary and named raw text-size utilities", () => {
    // Absolute units only. `text-[0.7rem]` in `ui/badge` survived the px-only form of this gate
    // through every earlier sweep; `em` stays legal because `text-[1em]` is an inheritance
    // instruction — `PROSE_CLASS` is composed at two different tiers by its two consumers.
    const re =
      /(?<![-\w])text-(?:\[(?:\d+(?:\.\d+)?|\.\d+)(?:px|rem)\]|xs|sm|base|lg|xl|\d+xl)(?![-\w])/g;
    assertZero("rawTextSize", scan(FILES, re));
  });

  it("rawButton — <button> outside components/ui + components/lang", () => {
    assertZero(
      "rawButton",
      scan(
        FILES.filter((f) => isTsx(f) && !inUiOrLang(f)),
        /<button\b/g,
      ),
    );
  });

  it("no ui/button imports", () => {
    assertZero("uiButtonImports", scan(FILES, /from\s+["'][^"']*ui\/button["']/g));
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
    assertZero("dashed", [...scan(files, edge), ...scan(files, stroke)]);
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
    assertZero("longTitle", offences);
  });
});
