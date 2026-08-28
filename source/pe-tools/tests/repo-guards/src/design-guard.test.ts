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

  it("projects the shared uppercase case marker through Tailwind", () => {
    const base = FILES.find((f) => f.rel === "base.css")?.text ?? "";
    const lang = FILES.find((f) => f.rel === "design-lang.css")?.text ?? "";
    const rule =
      /(?:\.t-upper|@utility\s+t-upper)\s*\{(?=[^}]*font-weight:\s*var\(--weight-strong\))(?=[^}]*letter-spacing:\s*0\.08em)(?=[^}]*text-transform:\s*uppercase)[^}]*\}/s;
    expect(base, "base.css wiring for t-upper").toMatch(rule);
    expect(lang, "design-lang.css wiring for t-upper").toMatch(rule);
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

  it("projects the shared spacing unit through Tailwind", () => {
    const base = FILES.find((f) => f.rel === "base.css")?.text ?? "";
    const lang = FILES.find((f) => f.rel === "design-lang.css")?.text ?? "";
    expect(base, "base.css spacing unit").toContain("--space-unit: 0.25rem;");
    expect(lang, "design-lang.css spacing projection").toContain("--spacing: var(--space-unit);");
  });

  it("projects the shared control motion through Tailwind defaults", () => {
    const base = FILES.find((f) => f.rel === "base.css")?.text ?? "";
    const lang = FILES.find((f) => f.rel === "design-lang.css")?.text ?? "";
    expect(base).toContain("--motion-control: 120ms;");
    expect(lang).toContain("--default-transition-duration: var(--motion-control);");
    expect(lang).toContain("--tw-animation-duration: var(--motion-control);");
  });

  it("projects composed veil and caution fills from one raw recipe each", () => {
    const base = FILES.find((f) => f.rel === "base.css")?.text ?? "";
    const lang = FILES.find((f) => f.rel === "design-lang.css")?.text ?? "";
    expect(base).toContain("--pattern-caution-hatch: repeating-linear-gradient(");
    expect(base.match(/repeating-linear-gradient/g)?.length).toBe(1);
    expect(base).toContain("--fill-veil: linear-gradient(var(--pe-veil), var(--pe-veil));");
    expect(base).toContain("background-image: var(--pattern-caution-hatch);");
    expect(lang).toContain("background-image: var(--pattern-caution-hatch);");
    expect(base).toContain("background-image: var(--fill-veil);");
    expect(lang).toContain("background-image: var(--fill-veil);");
  });

  it("routes the prose plugin's size and weight-bearing elements through the design tiers", () => {
    const base = FILES.find((f) => f.rel === "base.css")?.text ?? "";
    expect(base).toMatch(
      /\[data-pe\] \.prose-pe\s*\{(?=[^}]*font-size:\s*var\(--type-prose-size\))(?=[^}]*line-height:\s*var\(--type-prose-line-height\))/s,
    );
    expect(base).toContain(":where(h1, h2, h3, h4, h5, h6)");
    expect(base).toContain(':where([class~="lead"])');
    expect(base).toContain(":where(code, pre, table, kbd, figcaption)");
    expect(base).toContain(":where(p, ul, ol, li, pre)");
    expect(base).toContain(":where(a, blockquote, kbd)");
    expect(base).toContain(":where(strong, dt, th)");
    for (const name of ["lead", "kbd", "kbd-shadows", "pre-code", "pre-bg"]) {
      expect(base, `prose color variable ${name}`).toContain(`--tw-prose-${name}:`);
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

/** Keep browser-effective template CSS while masking only data substitutions. */
const maskTemplateExpressions = (text: string): string =>
  text.replace(/\$\{[^}]*\}/g, (m) => m.replace(/[^\n]/g, "_"));

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

  it("has no raw exact 2px radius outside the foundation", () => {
    const files = FILES.filter((f) => f.rel !== "base.css" && f.rel !== "design-lang.css").map(
      (f) => ({ ...f, text: stripComments(f.text) }),
    );
    const re = new RegExp(
      [
        "rounded-\\[2px\\]",
        "borderRadius\\s*[:=]\\s*[\"']?2(?:px)?[\"']?(?=\\s*[,};])",
        "border-radius\\s*:\\s*2px(?=\\s*[;}]|$)",
      ].join("|"),
      "g",
    );
    expect(
      scan(
        [
          {
            rel: "negative-radius.tsx",
            text: "borderRadius: 20, border-radius: 20px; rounded-[20px]",
          },
        ],
        re,
      ),
    ).toEqual([]);
    assertZero("exactRadius", scan(files, re));
  });

  it("no raw leading utilities", () => {
    assertZero("rawLeading", scan(FILES, /(?<![-\w])leading-[\w[\].-]+/g));
  });

  it("uses t-upper instead of raw uppercase utilities or authored transforms", () => {
    const files = FILES.filter(
      (f) =>
        f.rel !== "base.css" &&
        f.rel !== "design-lang.css" &&
        !f.rel.startsWith("components/lang/"),
    ).map((f) => ({ ...f, text: stripComments(f.text) }));
    const utility = /(?<![-\w])uppercase(?![-\w])/g;
    const declaration = /text-transform\s*:\s*uppercase\b/gi;
    assertZero("rawUppercase", [...scan(files, utility), ...scan(files, declaration)]);
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

  it("has no static numeric CSS colors or stock palette utilities outside the foundation", () => {
    const files = FILES.filter((f) => f.rel !== "base.css").map((f) => ({
      ...f,
      text: maskTemplateExpressions(stripComments(f.text)),
    }));
    const numericColor =
      /\b(?:rgba?|hsla?|oklch|oklab|lab|lch|hwb)\(\s*[-+]?(?:\d+(?:\.\d*)?|\.\d+)(?:%|deg|grad|rad|turn)?(?=\s|,|\/|\))/gi;
    const displayP3 = /\bcolor\(\s*display-p3\s+[-+]?(?:\d+(?:\.\d*)?|\.\d+)(?=\s|\/|\))/gi;
    const namedColor =
      /\b(?:color|fill|stroke|background(?:-[\w-]+)?|border(?:-[\w-]+)?|outline(?:-[\w-]+)?|(?:box|text)-shadow)\s*[:=][^;\n}]*\b(?:aliceblue|antiquewhite|aqua|aquamarine|azure|beige|bisque|black|blanchedalmond|blue|blueviolet|brown|burlywood|cadetblue|chartreuse|chocolate|coral|cornflowerblue|cornsilk|crimson|cyan|darkblue|darkcyan|darkgoldenrod|darkgray|darkgreen|darkgrey|darkkhaki|darkmagenta|darkolivegreen|darkorange|darkorchid|darkred|darksalmon|darkseagreen|darkslateblue|darkslategray|darkslategrey|darkturquoise|darkviolet|deeppink|deepskyblue|dimgray|dimgrey|dodgerblue|firebrick|floralwhite|forestgreen|fuchsia|gainsboro|ghostwhite|gold|goldenrod|gray|green|greenyellow|grey|honeydew|hotpink|indianred|indigo|ivory|khaki|lavender|lavenderblush|lawngreen|lemonchiffon|lightblue|lightcoral|lightcyan|lightgoldenrodyellow|lightgray|lightgreen|lightgrey|lightpink|lightsalmon|lightseagreen|lightskyblue|lightslategray|lightslategrey|lightsteelblue|lightyellow|lime|limegreen|linen|magenta|maroon|mediumaquamarine|mediumblue|mediumorchid|mediumpurple|mediumseagreen|mediumslateblue|mediumspringgreen|mediumturquoise|mediumvioletred|midnightblue|mintcream|mistyrose|moccasin|navajowhite|navy|oldlace|olive|olivedrab|orange|orangered|orchid|palegoldenrod|palegreen|paleturquoise|palevioletred|papayawhip|peachpuff|peru|pink|plum|powderblue|purple|rebeccapurple|red|rosybrown|royalblue|saddlebrown|salmon|sandybrown|seagreen|seashell|sienna|silver|skyblue|slateblue|slategray|slategrey|snow|springgreen|steelblue|tan|teal|thistle| tomato|transparent|turquoise|violet|wheat|white|whitesmoke|yellow|yellowgreen)\b/gi;
    const stockPalette =
      /(?<![-\w])(?:bg|text|border|divide|ring|outline|fill|stroke)-(?:white|black|slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)(?:-\d{2,3})?(?:\/\d+)?(?![-\w])/g;
    const namedOffences = scan(files, namedColor).filter(
      (o) => !/\b(?:transparent|currentColor|inherit)\b/i.test(o.match),
    );
    assertZero("staticColor", [
      ...scan(files, numericColor),
      ...scan(files, displayP3),
      ...namedOffences,
      ...scan(files, stockPalette),
    ]);
  });

  it("uses shared elevation tokens for non-inset shadows", () => {
    const files = FILES.filter((f) => f.rel !== "base.css" && f.rel !== "design-lang.css").map(
      (f) => ({ ...f, text: maskTemplateExpressions(stripComments(f.text)) }),
    );
    const declaration = /(?:box-shadow|boxShadow)\s*[:=][^;}]*/g;
    const declarations = scan(files, declaration).filter((o) => {
      const value = o.match;
      return (
        !/\binset\b/.test(value) &&
        !/\bvar\(\s*--shadow-(?:float|modal)\s*\)/.test(value) &&
        !/\bvar\(\s*--dl-cell-ring(?:\s*[,)]|\s)/.test(value) &&
        !/^\s*(?:box-shadow|boxShadow)\s*[:=]\s*none\s*$/i.test(value)
      );
    });
    const utility =
      /(?<![-\w])(?:shadow-[\w[\].:%()/-]+|drop-shadow(?:-[\w[\].:%()/-]+)?)(?![-\w])/g;
    const bareUtility = /\b(?:className|class)\s*=\s*["'`][^"'`]*\bshadow(?=\s|["'`])/g;
    const allowed = new Set([
      "shadow-none",
      "shadow-sm",
      "shadow-lg",
      "shadow-float",
      "shadow-modal",
    ]);
    const utilities = [...scan(files, utility), ...scan(files, bareUtility)].filter(
      (o) => !allowed.has(o.match),
    );
    const filters = scan(files, /\b(?:filter\s*[:=][^;}]*drop-shadow|text-shadow\s*[:=][^;}]*)/gi);
    assertZero("rawElevation", [...declarations, ...utilities, ...filters]);
  });

  it("uses the shared control duration for fixed motion", () => {
    const files = FILES.filter((f) => f.rel !== "base.css" && f.rel !== "design-lang.css").map(
      (f) => ({ ...f, text: maskTemplateExpressions(stripComments(f.text)) }),
    );
    const utility =
      /(?<![-\w])(?:duration-(?:\[(?:\d+(?:\.\d+)?|\.\d+)(?:ms|s)\]|\d+)|animate-\[[^\]]*_\d+(?:\.\d+)?(?:ms|s)(?:_|\]))(?![-\w])/g;
    const declaration =
      /\b(?:transition(?:Property|Duration)?|animation(?:Name|Duration)?)\s*[:=][^;\n}]{0,600}\b\d+(?:\.\d+)?(?:ms|s)\b/g;
    assertZero("fixedMotion", [...scan(files, utility), ...scan(files, declaration)]);
  });

  it("catches static template CSS colors but allows data-driven color arguments", () => {
    const fixture = [
      {
        rel: "static-template.tsx",
        text: "`color: rgb(12 34 56); border-color: hsl(120 50% 40%);`",
      },
      {
        rel: "dynamic-template.tsx",
        text: "`color: rgb(${r} ${g} ${b}); border-color: hsl(${hue} 50% 40%);`",
      },
    ].map((f) => ({ ...f, text: maskTemplateExpressions(f.text) }));
    const numericColor =
      /\b(?:rgba?|hsla?|oklch|oklab|lab|lch|hwb)\(\s*[-+]?(?:\d+(?:\.\d*)?|\.\d+)(?:%|deg|grad|rad|turn)?(?=\s|,|\/|\))/gi;
    expect(scan(fixture.slice(0, 1), numericColor)).not.toEqual([]);
    expect(scan(fixture.slice(1), numericColor)).toEqual([]);
  });

  it("catches authored paint colors and elevation escapes but keeps dynamic and shared forms legal", () => {
    const paint = [
      { rel: "paint.css", text: "color: oklab(0.7 0.1 0.2); fill: hwb(120 20% 30%);" },
      { rel: "paint.css", text: "stroke: color(display-p3 0.2 0.3 0.4); border: 1px solid red;" },
      { rel: "paint.tsx", text: "`color: rgb(${r} ${g} ${b}); background: currentColor;`" },
    ].map((f) => ({ ...f, text: maskTemplateExpressions(f.text) }));
    const color =
      /\b(?:rgba?|hsla?|oklch|oklab|lab|lch|hwb)\(\s*[-+]?(?:\d+(?:\.\d*)?|\.\d+)(?:%|deg|grad|rad|turn)?(?=\s|,|\/|\))/gi;
    const p3 = /\bcolor\(\s*display-p3\s+[-+]?(?:\d+(?:\.\d*)?|\.\d+)(?=\s|\/|\))/gi;
    const names = /\b(?:color|fill|stroke|border)\s*[:=][^;\n}]*\b(?:red|blue|white|black)\b/gi;
    expect(scan(paint.slice(0, 2), color)).not.toEqual([]);
    expect(scan(paint.slice(0, 2), p3)).not.toEqual([]);
    expect(scan(paint.slice(1, 2), names)).not.toEqual([]);
    expect([
      ...scan(paint.slice(2), color),
      ...scan(paint.slice(2), p3),
      ...scan(paint.slice(2), names),
    ]).toEqual([]);

    const shadows = [
      { rel: "shadow.tsx", text: 'className="shadow-md drop-shadow-sm"' },
      {
        rel: "shadow.css",
        text: "filter: drop-shadow(0 1px 2px red); text-shadow: 0 1px red;",
      },
      {
        rel: "shadow.css",
        text: "box-shadow: var(--shadow-float); box-shadow: inset 0 0 0 1px red;",
      },
    ];
    const utility =
      /(?<![-\w])(?:shadow-[\w[\].:%()/-]+|drop-shadow(?:-[\w[\].:%()/-]+)?)(?![-\w])/g;
    const bareUtility = /\b(?:className|class)\s*=\s*["'`][^"'`]*\bshadow(?=\s|["'`])/g;
    const allowed = new Set([
      "shadow-none",
      "shadow-sm",
      "shadow-lg",
      "shadow-float",
      "shadow-modal",
    ]);
    expect(
      [...scan(shadows.slice(0, 1), utility), ...scan(shadows.slice(0, 1), bareUtility)].filter(
        (o) => !allowed.has(o.match),
      ),
    ).not.toEqual([]);
    expect(
      [...scan(shadows.slice(2), utility), ...scan(shadows.slice(2), bareUtility)].filter(
        (o) => !allowed.has(o.match),
      ),
    ).toEqual([]);
  });

  it("uses semantic layers for global stacking", () => {
    const files = FILES.filter((f) => f.rel !== "base.css" && f.rel !== "design-lang.css").map(
      (f) => ({ ...f, text: stripComments(f.text) }),
    );
    const re =
      /(?<![-\w])z-(?:10|20|30|40|50|60|\[9999\])(?![-\w])|\bzIndex\s*[:=]\s*(?:10|20|30|40|50|60|9999)\b|\bz-index\s*:\s*(?:10|20|30|40|50|60|9999)\b/g;
    assertZero("globalLayer", scan(files, re));
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
