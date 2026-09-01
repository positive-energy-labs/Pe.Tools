/**
 * =============================================================================================
 * THE DESIGN GUARD — the enforcement lever of the one-system design sweep.
 * =============================================================================================
 *
 * This test IS the lint. `@pe/repo-guards#test` runs in the `ready` lane, so the
 * token discipline that held by review during the sweep now holds by assertion. It encodes the
 * census gates driven to zero in the one-system design sweep (closed 2026-08-16; see the
 * Enforcement lines in docs/features/design-system/LEDGER.md). It walks src/**\/*.{ts,tsx,css}
 * once and uses the TypeScript and Tailwind dependencies already wired into the web package.
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
 *  3. hex literals       #rrggbb / #rrggbbaa outside base.css. THE LAW in the canon
 *                        header: "no component, no route, and no CSS file downstream may name
 *                        a colour literal" — a colour is a one-line edit in base.css.
 *  4. sub-10px type      text-[Npx] with N < 10. The 10px floor from the type-tier ruling
 *                        (ops enforced it on itself; the flagship pass finished the job).
 *  5. inline backgrounds  background: in TypeScript/TSX style objects. The shared veil uses
 *                        background-image, so a shorthand reset is forbidden; CSS declarations
 *                        remain legal.
 *
 * ── HARD ZERO (every category below must remain empty) ─────────────────────────────────────
 *  rawTextSize      any raw text-[Npx|Nrem]. Named off-system sizes emit no CSS and are caught
 *                   by the compiler census.
 *  rawButton        <button> outside components/lang. World actions are
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
 *  rawFace          ui-monospace and --font-pe-mono outside the foundation. Off-system face
 *                   utilities emit no CSS and are caught by the compiler census.
 *  longTitle        title= props over 240 characters. Long guidance belongs in visible HelpTip
 *                   content; instance facts may remain in title attributes.
 *
 *  The walk covers every apps/web/src TypeScript, TSX, and CSS file, including prototype paths.
 *  Only the generated route tree is excluded; mounted prototypes remain maintained surface.
 *
 *  Value rules use focused regexes. Class and export rules use the TypeScript AST plus Tailwind's
 *  own compiler, so strings are checked in their authored context instead of as loose source text.
 * =============================================================================================
 */
import { readdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, posix, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import ts from "../../../apps/web/node_modules/typescript/lib/typescript.js";
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

  it("has no shadcn semantic color vars", () => {
    const names =
      "background|foreground|primary|secondary|muted|accent|destructive|card|popover|border|input|ring|sidebar|chart-[1-5]";
    const re = new RegExp(
      `var\\(--(?:color-)?(?:${names})(?![-\\w])|["']--(?:color-)?(?:${names})(?![-\\w])["']\\s*:|(?:^|[,{;\\n])\\s*--(?:color-)?(?:${names})(?![-\\w])\\s*:`,
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

  it("uses one face variable outside the foundation", () => {
    const files = FILES.filter((f) => f.rel !== "base.css" && f.rel !== "design-lang.css").map(
      (f) => ({
        ...f,
        text: stripComments(f.text),
      }),
    );
    const re = /ui-monospace|--font-pe-mono/g;
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

  it("has no static numeric CSS colors outside the foundation", () => {
    const files = FILES.filter((f) => f.rel !== "base.css").map((f) => ({
      ...f,
      text: maskTemplateExpressions(stripComments(f.text)),
    }));
    const numericColor =
      /\b(?:rgba?|hsla?|oklch|oklab|lab|lch|hwb)\(\s*[-+]?(?:\d+(?:\.\d*)?|\.\d+)(?:%|deg|grad|rad|turn)?(?=\s|,|\/|\))/gi;
    const displayP3 = /\bcolor\(\s*display-p3\s+[-+]?(?:\d+(?:\.\d*)?|\.\d+)(?=\s|\/|\))/gi;
    const namedColor =
      /\b(?:color|fill|stroke|background(?:-[\w-]+)?|border(?:-[\w-]+)?|outline(?:-[\w-]+)?|(?:box|text)-shadow)\s*[:=][^;\n}]*\b(?:aliceblue|antiquewhite|aqua|aquamarine|azure|beige|bisque|black|blanchedalmond|blue|blueviolet|brown|burlywood|cadetblue|chartreuse|chocolate|coral|cornflowerblue|cornsilk|crimson|cyan|darkblue|darkcyan|darkgoldenrod|darkgray|darkgreen|darkgrey|darkkhaki|darkmagenta|darkolivegreen|darkorange|darkorchid|darkred|darksalmon|darkseagreen|darkslateblue|darkslategray|darkslategrey|darkturquoise|darkviolet|deeppink|deepskyblue|dimgray|dimgrey|dodgerblue|firebrick|floralwhite|forestgreen|fuchsia|gainsboro|ghostwhite|gold|goldenrod|gray|green|greenyellow|grey|honeydew|hotpink|indianred|indigo|ivory|khaki|lavender|lavenderblush|lawngreen|lemonchiffon|lightblue|lightcoral|lightcyan|lightgoldenrodyellow|lightgray|lightgreen|lightgrey|lightpink|lightsalmon|lightseagreen|lightskyblue|lightslategray|lightslategrey|lightsteelblue|lightyellow|lime|limegreen|linen|magenta|maroon|mediumaquamarine|mediumblue|mediumorchid|mediumpurple|mediumseagreen|mediumslateblue|mediumspringgreen|mediumturquoise|mediumvioletred|midnightblue|mintcream|mistyrose|moccasin|navajowhite|navy|oldlace|olive|olivedrab|orange|orangered|orchid|palegoldenrod|palegreen|paleturquoise|palevioletred|papayawhip|peachpuff|peru|pink|plum|powderblue|purple|rebeccapurple|red|rosybrown|royalblue|saddlebrown|salmon|sandybrown|seagreen|seashell|sienna|silver|skyblue|slateblue|slategray|slategrey|snow|springgreen|steelblue|tan|teal|thistle| tomato|transparent|turquoise|violet|wheat|white|whitesmoke|yellow|yellowgreen)\b/gi;
    const namedOffences = scan(files, namedColor).filter(
      (o) => !/\b(?:transparent|currentColor|inherit)\b/i.test(o.match),
    );
    assertZero("staticColor", [
      ...scan(files, numericColor),
      ...scan(files, displayP3),
      ...namedOffences,
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

// ── checks that code can hold ────────────────────────────────────────────────────────────────

type ClassUse = { rel: string; line: number; token: string };

const tokenise = (text: string): string[] => text.split(/\s+/).filter(Boolean);

const propertyName = (name: ts.PropertyName | undefined): string | undefined => {
  if (!name) return undefined;
  return ts.isIdentifier(name) || ts.isStringLiteral(name) ? name.text : undefined;
};

const classStrings = (node: ts.Node, source: ts.SourceFile, rel: string, out: ClassUse[]): void => {
  const add = (text: string, at: ts.Node) => {
    const line = source.getLineAndCharacterOfPosition(at.getStart(source)).line + 1;
    for (const token of tokenise(text)) out.push({ rel, line, token });
  };

  if (ts.isStringLiteralLike(node)) {
    add(node.text, node);
    return;
  }
  if (ts.isTemplateExpression(node)) {
    add(node.head.text, node.head);
    for (const span of node.templateSpans) {
      classStrings(span.expression, source, rel, out);
      add(span.literal.text, span.literal);
    }
    return;
  }
  if (ts.isParenthesizedExpression(node)) {
    classStrings(node.expression, source, rel, out);
    return;
  }
  if (ts.isJsxExpression(node)) {
    if (node.expression) classStrings(node.expression, source, rel, out);
    return;
  }
  if (ts.isConditionalExpression(node)) {
    classStrings(node.whenTrue, source, rel, out);
    classStrings(node.whenFalse, source, rel, out);
    return;
  }
  if (ts.isBinaryExpression(node)) {
    if (node.operatorToken.kind !== ts.SyntaxKind.AmpersandAmpersandToken)
      classStrings(node.left, source, rel, out);
    classStrings(node.right, source, rel, out);
    return;
  }
  if (ts.isArrayLiteralExpression(node)) {
    for (const item of node.elements) classStrings(item, source, rel, out);
    return;
  }
  if (ts.isObjectLiteralExpression(node)) {
    for (const p of node.properties) {
      if (ts.isPropertyAssignment(p)) {
        const name = propertyName(p.name);
        if (name) add(name, p.name);
      } else if (ts.isShorthandPropertyAssignment(p)) add(p.name.text, p.name);
      else if (ts.isSpreadAssignment(p)) classStrings(p.expression, source, rel, out);
    }
    return;
  }
  if (
    ts.isCallExpression(node) &&
    ts.isIdentifier(node.expression) &&
    node.expression.text === "cn"
  ) {
    for (const arg of node.arguments) classStrings(arg, source, rel, out);
  }
};

const objectValues = (
  node: ts.Expression,
  source: ts.SourceFile,
  rel: string,
  out: ClassUse[],
): void => {
  if (!ts.isObjectLiteralExpression(node)) return;
  for (const p of node.properties)
    if (ts.isPropertyAssignment(p)) classStrings(p.initializer, source, rel, out);
};

const tvStrings = (
  call: ts.CallExpression,
  source: ts.SourceFile,
  rel: string,
  out: ClassUse[],
) => {
  const config = call.arguments[0];
  if (!config || !ts.isObjectLiteralExpression(config)) return;
  for (const p of config.properties) {
    if (!ts.isPropertyAssignment(p)) continue;
    const name = propertyName(p.name);
    if (name === "base") classStrings(p.initializer, source, rel, out);
    if (name === "slots") objectValues(p.initializer, source, rel, out);
    if (name === "variants" && ts.isObjectLiteralExpression(p.initializer)) {
      for (const variant of p.initializer.properties) {
        if (!ts.isPropertyAssignment(variant) || !ts.isObjectLiteralExpression(variant.initializer))
          continue;
        for (const option of variant.initializer.properties) {
          if (!ts.isPropertyAssignment(option)) continue;
          if (ts.isObjectLiteralExpression(option.initializer))
            objectValues(option.initializer, source, rel, out);
          else classStrings(option.initializer, source, rel, out);
        }
      }
    }
    if (name === "compoundVariants" && ts.isArrayLiteralExpression(p.initializer)) {
      for (const entry of p.initializer.elements) {
        if (!ts.isObjectLiteralExpression(entry)) continue;
        for (const field of entry.properties) {
          if (
            ts.isPropertyAssignment(field) &&
            ["class", "className"].includes(propertyName(field.name) ?? "")
          )
            classStrings(field.initializer, source, rel, out);
        }
      }
    }
  }
};

const classUses = (files: Entry[] = FILES): ClassUse[] => {
  const out: ClassUse[] = [];
  for (const file of files.filter((f) => /\.tsx?$/.test(f.rel))) {
    const source = ts.createSourceFile(
      file.rel,
      file.text,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TSX,
    );
    const visit = (node: ts.Node): void => {
      if (ts.isJsxAttribute(node) && node.name.getText(source) === "className") {
        if (node.initializer) classStrings(node.initializer, source, file.rel, out);
        return;
      }
      if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
        if (node.expression.text === "cn") {
          for (const arg of node.arguments) classStrings(arg, source, file.rel, out);
          return;
        }
        if (node.expression.text === "tv") {
          tvStrings(node, source, file.rel, out);
          return;
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  return [...new Map(out.map((use) => [`${use.rel}:${use.line}:${use.token}`, use])).values()];
};

const TONE_VALUES = new Set(["alarm", "caution", "done", "commit", "nav", "pea"]);
const SURFACE_VALUES = new Set(["page", "artifact", "recess", "document"]);

const invalidDataValues = (
  attribute: string,
  allowed: ReadonlySet<string>,
  files: Entry[] = FILES,
): Offence[] => {
  const out: Offence[] = [];
  for (const file of files.filter((f) => f.rel.endsWith(".tsx"))) {
    const source = ts.createSourceFile(
      file.rel,
      file.text,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TSX,
    );
    const visit = (node: ts.Node): void => {
      if (ts.isJsxAttribute(node) && node.name.getText(source) === attribute) {
        const check = (value: ts.Node): void => {
          if (ts.isStringLiteralLike(value) && !allowed.has(value.text)) {
            out.push({
              rel: file.rel,
              line: source.getLineAndCharacterOfPosition(value.getStart(source)).line + 1,
              match: value.text,
            });
            return;
          }
          if (ts.isJsxExpression(value) && value.expression) check(value.expression);
          else if (ts.isConditionalExpression(value)) {
            check(value.whenTrue);
            check(value.whenFalse);
          } else if (
            ts.isParenthesizedExpression(value) ||
            ts.isAsExpression(value) ||
            ts.isSatisfiesExpression(value)
          )
            check(value.expression);
        };
        if (node.initializer) check(node.initializer);
        return;
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  return out;
};

const invalidDataTones = (files: Entry[] = FILES): Offence[] =>
  invalidDataValues("data-tone", TONE_VALUES, files);
const invalidDataSurfaces = (files: Entry[] = FILES): Offence[] =>
  invalidDataValues("data-surface", SURFACE_VALUES, files);

const CLASS_USES = classUses();
const webRequire = createRequire(join(ROOT, "../package.json"));
const viteRequire = createRequire(webRequire.resolve("@tailwindcss/vite"));
const tailwindNode = (await import(
  pathToFileURL(viteRequire.resolve("@tailwindcss/node")).href
)) as {
  compile(
    css: string,
    options: { base: string; from: string; onDependency(path: string): void },
  ): Promise<{ build(candidates: string[]): string }>;
};

const cssRel = (specifier: string, importer: string): string | undefined => {
  const clean = specifier.replace(/\?.*$/, "");
  if (!clean.endsWith(".css")) return undefined;
  if (clean.startsWith("#/")) return clean.slice(2);
  return clean.startsWith(".")
    ? posix.normalize(posix.join(posix.dirname(importer), clean))
    : undefined;
};

const CSS_ENTRIES = new Set<string>();
for (const file of FILES.filter((f) => /\.tsx?$/.test(f.rel))) {
  const source = ts.createSourceFile(
    file.rel,
    file.text,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  for (const statement of source.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier))
      continue;
    const rel = cssRel(statement.moduleSpecifier.text, file.rel);
    if (rel) CSS_ENTRIES.add(rel);
  }
}

const CSS_BY_REL = new Map(FILES.filter((f) => f.rel.endsWith(".css")).map((f) => [f.rel, f]));
const LIVE_CSS = new Set(CSS_ENTRIES);
for (const rel of LIVE_CSS) {
  const file = CSS_BY_REL.get(rel);
  if (!file) continue;
  for (const match of file.text.matchAll(/@import\s+(?:url\()?\s*["']([^"']+)["']/g)) {
    const imported = cssRel(match[1], rel);
    if (imported) LIVE_CSS.add(imported);
  }
}

const cssUnescape = (value: string): string =>
  value.replace(/\\(?:([0-9a-fA-F]{1,6})\s?|([^\r\n]))/g, (_, hex: string, escaped: string) =>
    hex ? String.fromCodePoint(Number.parseInt(hex, 16)) : escaped,
  );
const cssClasses = (css: string): Set<string> => {
  const classes = new Set<string>();
  for (const block of stripComments(css).matchAll(/([^{}]+)\{/g)) {
    for (const match of block[1].matchAll(
      /\.((?:\\[0-9a-fA-F]{1,6}\s?|\\[^\r\n]|[\w\u0080-\uFFFF-])+)/g,
    ))
      classes.add(cssUnescape(match[1]));
  }
  return classes;
};

const APP_CSS = [...CSS_ENTRIES]
  .sort()
  .map((rel) => `@import "./${rel}";`)
  .join("\n");
const CSS_ENTRY = join(ROOT, "styles.css");
const compiler = await tailwindNode.compile(APP_CSS, {
  base: ROOT,
  from: CSS_ENTRY,
  onDependency() {},
});
const LOADER_PRESENT = [
  "flex",
  "h-4",
  "face-mono",
  "t-caption",
  "text-ink-2",
  "z-modal",
  "dl-cell",
  "hairline-t",
  "hairline-b",
  "hairline-l",
  "hairline-r",
  "hairline-x",
  "hairline-y",
  "hairline-rows",
  "hairline-t-faint",
  "hairline-b-faint",
  "hairline-l-faint",
  "hairline-x-faint",
  "hairline-y-faint",
  "hairline-t-2",
  "hairline-b-2",
  "hairline-l-2",
  "hairline-r-2",
  "hairline-x-2",
  "hairline-y-2",
  "boundary-t",
  "boundary-l",
];
const LOADER_ABSENT = ["text-red-500", "text-xs", "font-mono"];
const candidates = [
  ...new Set([...CLASS_USES.map((use) => use.token), ...LOADER_PRESENT, ...LOADER_ABSENT]),
];
const builtCss = compiler.build(candidates);
const registered = cssClasses(builtCss);
const REMAINDER = CLASS_USES.filter(
  (use) => !registered.has(use.token) && !/^(?:group|peer)(?:\/[\w-]+)?$/.test(use.token),
);

const baseClass = (candidate: string): string => {
  let depth = 0;
  let start = 0;
  for (let i = 0; i < candidate.length; i++) {
    if ("[(".includes(candidate[i])) depth++;
    else if ("])".includes(candidate[i])) depth--;
    else if (candidate[i] === ":" && depth === 0) start = i + 1;
  }
  return candidate.slice(start).replace(/^!|!$/g, "").replace(/^-/, "");
};

const DEAD_CSS_CLASSES = new Map<string, Set<string>>(
  [...CSS_BY_REL]
    .filter(([rel]) => !LIVE_CSS.has(rel))
    .map(([rel, file]) => [rel, cssClasses(file.text)]),
);
const DEAD_VOCABULARY = REMAINDER.filter((use) =>
  [...DEAD_CSS_CLASSES.values()].some((classes) => classes.has(baseClass(use.token))),
);
const PLUGIN_ONLY = REMAINDER.filter(
  (use) =>
    !DEAD_VOCABULARY.includes(use) &&
    /(?:^|:)(?:data-open|supports-backdrop-filter):/.test(use.token),
);
const TRUE_UNREGISTERED = REMAINDER.filter(
  (use) => !DEAD_VOCABULARY.includes(use) && !PLUGIN_ONLY.includes(use),
);

/** Product code may author GEOMETRY plus TYPE (tier, face, case) and INK (the three text inks).
 *  Ruled 2026-08-30: the `{}` allowlist stripped ~1,100 `t-*`/`face-*` sites and left product
 *  text at browser defaults. Meaning hues, fills, and colored strokes stay component-only. */
const AUTHORING =
  /^(?:hairline-(?:(?:[tblrxy])(?:-2|-faint)?|rows)|boundary-[tl]|t-(?:caption|label|value|prose|title|head|display|upper)|face-(?:mono|display)|text-(?:ink|ink-2|ink-mute)|(?:(?:flex|grid)(?:-.+)?|inline-(?:flex|grid|block)|block|hidden|(?:shrink|grow)(?:-.+)?|basis-.+|gap(?:-[xy])?-.+|space-[xy]-.+|[pm][xytrblse]?-.+|[wh]-.+|size-.+|(?:min|max)-[wh]-.+|(?:absolute|relative|fixed|sticky)|(?:inset|top|right|bottom|left)(?:-[xy])?-.+|(?:translate|rotate|scale|origin)(?:-[xy])?-.+|overflow(?:-[xy])?(?:-.+)?|truncate|text-(?:left|center|right|justify|start|end|ellipsis)|whitespace-.+|break-(?:words|all|normal|keep)|items-.+|justify-.+|self-.+|content-.+|place-(?:items|content|self)-.+|align-.+|col-.+|row-.+|object-.+|aspect-.+|table-(?:auto|fixed)|border-collapse|resize(?:-[xy])?|pointer-events-.+|cursor-.+|select-none|list-none|\[writing-mode:.+\]|transition-transform|duration-.+|(?:group|peer)(?:\/.+)?|z-.+))$/;
const COLOR_ROLE =
  "(?:page|artifact|recess|select|document|scrim|ink|ink-2|ink-mute|line|line-2|pea|pea-ink|alarm|caution|done|commit|on-commit|nav|on|viz-[1-6])(?:/[\\d.]+)?";
const MEANING_FILL_STROKE = new RegExp(
  `^(?:(?:bg|text|fill|stroke|from|via|to)-${COLOR_ROLE}|border(?:-[xytrblse])?-${COLOR_ROLE}|divide-${COLOR_ROLE}|ring-${COLOR_ROLE}|outline-${COLOR_ROLE}|hairline-(?:(?:[tblrxy])(?:-2|-faint)?|rows)|boundary-[tl]|on-(?:page|artifact|recess|select)|(?:ink|commit|alarm|pea|caution)-wash(?:-artifact)?|caution-hatch|inset-ring)$`,
);
const ALLOWLIST_VIOLATIONS = CLASS_USES.filter(
  (use) =>
    !use.rel.startsWith("components/") &&
    MEANING_FILL_STROKE.test(baseClass(use.token)) &&
    !AUTHORING.test(baseClass(use.token)),
);
const ALLOWLIST_BY_FILE = Object.fromEntries(
  [...new Set(ALLOWLIST_VIOLATIONS.map((use) => use.rel))]
    .sort()
    .map((rel) => [rel, ALLOWLIST_VIOLATIONS.filter((use) => use.rel === rel).length]),
);
const ALLOWLIST_BASELINE = JSON.parse(
  readFileSync(join(HERE, "design-allowlist.baseline.json"), "utf8"),
) as Record<string, number>;
const ALLOWLIST_LIVE_JSON = JSON.stringify(ALLOWLIST_BY_FILE, null, 2) + "\n";

const hasExport = (node: ts.Node): boolean =>
  ts.canHaveModifiers(node) &&
  !!ts.getModifiers(node)?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword);
const isPascal = (name: string): boolean => /^[A-Z][A-Za-z0-9]*$/.test(name);
const LANG_COMPONENTS = new Set<string>();
const LANG_RECIPES = new Set<string>();
for (const file of FILES.filter(
  (f) => f.rel.startsWith("components/lang/") && f.rel.endsWith(".tsx"),
)) {
  const source = ts.createSourceFile(
    file.rel,
    file.text,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  source.forEachChild((node) => {
    if (ts.isFunctionDeclaration(node) && hasExport(node) && node.name && isPascal(node.name.text))
      LANG_COMPONENTS.add(node.name.text);
    if (ts.isVariableStatement(node) && hasExport(node))
      for (const declaration of node.declarationList.declarations)
        if (
          ts.isIdentifier(declaration.name) &&
          isPascal(declaration.name.text) &&
          declaration.initializer &&
          (ts.isArrowFunction(declaration.initializer) ||
            ts.isFunctionExpression(declaration.initializer))
        )
          LANG_COMPONENTS.add(declaration.name.text);
    if (ts.isVariableStatement(node) && hasExport(node))
      for (const declaration of node.declarationList.declarations)
        if (
          ts.isIdentifier(declaration.name) &&
          declaration.name.text.endsWith("Recipe") &&
          declaration.initializer &&
          ts.isCallExpression(declaration.initializer) &&
          ts.isIdentifier(declaration.initializer.expression) &&
          declaration.initializer.expression.text === "tv"
        )
          LANG_RECIPES.add(declaration.name.text);
  });
}
const SPECIMEN_JSX = new Set<string>();
const RECIPE_GRID_USES = new Map<string, number>();
const SPECIMEN_PATH_USES = new Map<string, number>();
for (const specimen of FILES.filter(
  (file) => file.rel.startsWith("design-system/specimens/") && file.rel.endsWith(".tsx"),
)) {
  const source = ts.createSourceFile(
    specimen.rel,
    specimen.text,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const visit = (node: ts.Node): void => {
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      if (ts.isIdentifier(node.tagName)) SPECIMEN_JSX.add(node.tagName.text);
      if (
        ts.isIdentifier(node.tagName) &&
        (node.tagName.text === "RecipeGrid" || node.tagName.text === "SpecimenFrame")
      ) {
        const importPath = node.attributes.properties.find(
          (attribute): attribute is ts.JsxAttribute =>
            ts.isJsxAttribute(attribute) && attribute.name.getText(source) === "importPath",
        );
        if (importPath?.initializer && ts.isStringLiteral(importPath.initializer)) {
          const path = importPath.initializer.text;
          SPECIMEN_PATH_USES.set(path, (SPECIMEN_PATH_USES.get(path) ?? 0) + 1);
        }
      }
      if (ts.isIdentifier(node.tagName) && node.tagName.text === "RecipeGrid") {
        const recipe = node.attributes.properties.find(
          (attribute): attribute is ts.JsxAttribute =>
            ts.isJsxAttribute(attribute) && attribute.name.getText(source) === "recipe",
        );
        const expression = recipe?.initializer;
        if (
          expression &&
          ts.isJsxExpression(expression) &&
          expression.expression &&
          ts.isIdentifier(expression.expression)
        ) {
          const name = expression.expression.text;
          RECIPE_GRID_USES.set(name, (RECIPE_GRID_USES.get(name) ?? 0) + 1);
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
}
const MISSING_SWATCH = [...LANG_COMPONENTS].filter((name) => !SPECIMEN_JSX.has(name)).sort();
const REQUIRED_RECIPE_GRIDS = new Set([
  ...LANG_RECIPES,
  "dialogRecipe",
  "inputGroupRecipe",
  "selectRecipe",
]);
const BAD_RECIPE_GRIDS = [...REQUIRED_RECIPE_GRIDS]
  .filter((name) => RECIPE_GRID_USES.get(name) !== 1)
  .map((name) => `${name}: ${RECIPE_GRID_USES.get(name) ?? 0} grids`)
  .sort();

const REQUIRED_SPECIMEN_PATHS = [
  "#/components/lang/addressing-bar",
  "#/components/lang/arming-strip",
  "#/components/lang/artifact-frame",
  "#/components/lang/cell",
  "#/components/lang/cell-key",
  "#/components/lang/chip",
  "#/components/lang/coverage-bar",
  "#/components/lang/empty",
  "#/components/lang/help",
  "#/components/lang/outcome",
  "#/components/lang/press",
  "#/components/lang/section",
  "#/components/lang/switcher",
  "#/components/lang/verb",
  "#/components/lang/card",
  "#/components/lang/combobox",
  "#/components/lang/command",
  "#/components/lang/dialog",
  "#/components/lang/input",
  "#/components/lang/input-group",
  "#/components/lang/label",
  "#/components/lang/pane",
  "#/components/lang/pick-list",
  "#/components/lang/select",
  "#/components/lang/side-pane",
  "#/components/lang/switch",
  "#/components/lang/textarea",
  "#/components/lang/value-diff",
] as const;
const BAD_SPECIMEN_PATHS = REQUIRED_SPECIMEN_PATHS.filter(
  (importPath) => SPECIMEN_PATH_USES.get(importPath) !== 1,
).map((importPath) => `${importPath}: ${SPECIMEN_PATH_USES.get(importPath) ?? 0} frames`);

describe("design checks — code holds the boundary", () => {
  it("data-tone values come from the closed tone set", () => {
    const fixture = invalidDataTones([
      { rel: "fixture.tsx", text: '<span data-tone="warning" />' },
    ]);
    expect(fixture.map((offence) => offence.match)).toEqual(["warning"]);
    const offences = invalidDataTones();
    expect(offences, report(offences)).toEqual([]);
  });

  it("data-surface values come from the closed surface set", () => {
    const fixture = invalidDataSurfaces([
      { rel: "fixture.tsx", text: '<div data-surface="panel" />' },
    ]);
    expect(fixture.map((offence) => offence.match)).toEqual(["panel"]);
    const offences = invalidDataSurfaces();
    expect(offences, report(offences)).toEqual([]);
  });

  it("loads the app CSS graph before checking candidates", () => {
    expect(LOADER_PRESENT.filter((candidate) => !registered.has(candidate))).toEqual([]);
    expect(LOADER_ABSENT.filter((candidate) => registered.has(candidate))).toEqual([]);
  });

  it(`partitions unregistered classes (${DEAD_VOCABULARY.length} dead CSS, ${PLUGIN_ONLY.length} plugin-only)`, () => {
    expect(DEAD_VOCABULARY.length + PLUGIN_ONLY.length + TRUE_UNREGISTERED.length).toBe(
      REMAINDER.length,
    );
  });

  it(`unregistered classes — hard zero (${TRUE_UNREGISTERED.length} true unregistered)`, () => {
    expect(
      TRUE_UNREGISTERED,
      report(TRUE_UNREGISTERED.map((o) => ({ ...o, match: o.token }))),
    ).toEqual([]);
  });

  it(`meaning, fill and stroke utilities stay in components (${ALLOWLIST_VIOLATIONS.length} baseline exceptions)`, () => {
    const fixture = classUses([
      {
        rel: "fixture.tsx",
        text: `
          <div className={\`flex \${on ? "text-ink" : ""}\`} />;
          cn("grid", { border: on });
          tv({
            base: "t-label",
            slots: { root: "gap-2" },
            variants: { tone: { x: "bg-page" } },
            compoundVariants: [{ tone: "x", class: "shadow-sm" }],
          });
        `,
      },
    ]).map((use) => use.token);
    expect(fixture).toEqual([
      "flex",
      "text-ink",
      "grid",
      "border",
      "t-label",
      "gap-2",
      "bg-page",
      "shadow-sm",
    ]);
    const scopeFixture = classUses([
      {
        rel: "fixture.tsx",
        text: '<div className="leading-tight sr-only outline-none rounded-lg shadow-sm tracking-tight bg-page border-line text-caution hairline-b hairline-rows hairline-b-faint boundary-t" />',
      },
    ]).filter(
      (use) =>
        MEANING_FILL_STROKE.test(baseClass(use.token)) && !AUTHORING.test(baseClass(use.token)),
    );
    expect(scopeFixture.map((use) => use.token)).toEqual([
      "bg-page",
      "border-line",
      "text-caution",
    ]);
    const increases = Object.entries(ALLOWLIST_BY_FILE)
      .filter(([rel, count]) => count > (ALLOWLIST_BASELINE[rel] ?? 0))
      .map(([rel, count]) => `${rel}: ${count} > ${ALLOWLIST_BASELINE[rel] ?? 0}`);
    expect(increases).toEqual([]);
  });

  for (const rel of [
    ...new Set([...Object.keys(ALLOWLIST_BASELINE), ...Object.keys(ALLOWLIST_BY_FILE)]),
  ].sort()) {
    it(`${rel} allowlist baseline is not stale`, () => {
      const was = ALLOWLIST_BASELINE[rel] ?? 0;
      const now = ALLOWLIST_BY_FILE[rel] ?? 0;
      expect(
        now,
        `${rel} dropped to ${now}; baseline still says ${was}.\nPaste this exact JSON into design-allowlist.baseline.json:\n${ALLOWLIST_LIVE_JSON}`,
      ).toBeGreaterThanOrEqual(was);
    });
  }

  it("every lang component export is mounted by a specimen", () => {
    expect(MISSING_SWATCH).toEqual([]);
  });

  it("every swatch recipe is mounted once through the exhaustive recipe grid", () => {
    expect(BAD_RECIPE_GRIDS).toEqual([]);
  });

  it("every catalogued lang and ui import path has one specimen frame", () => {
    expect(BAD_SPECIMEN_PATHS).toEqual([]);
  });
});

const isTsx = (f: Entry) => f.rel.endsWith(".tsx");
const inLang = (f: Entry) => f.rel.startsWith("components/lang/");

const assertZero = (name: string, offences: Offence[]) => {
  expect(
    offences,
    `HARD ZERO "${name}" found ${offences.length} offender(s):\n${report(offences)}`,
  ).toEqual([]);
};

describe("design guard — maintained surface hard zeros", () => {
  it("rawTextSize — arbitrary raw text-size utilities", () => {
    // Absolute units only. `text-[0.7rem]` in `ui/badge` survived the px-only form of this gate
    // through every earlier sweep; `em` stays legal because `text-[1em]` is an inheritance
    // instruction — `PROSE_CLASS` is composed at two different tiers by its two consumers.
    const re = /(?<![-\w])text-\[(?:\d+(?:\.\d+)?|\.\d+)(?:px|rem)\](?![-\w])/g;
    assertZero("rawTextSize", scan(FILES, re));
  });

  it("rawButton — <button> outside components/lang", () => {
    assertZero(
      "rawButton",
      scan(
        FILES.filter((f) => isTsx(f) && !inLang(f)),
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
      (f) => !inLang(f) && f.rel !== "design-lang.css" && f.rel !== "base.css",
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
