/**
 * =============================================================================================
 * THE DESIGN GUARD — the enforcement lever of the one-system design sweep.
 * =============================================================================================
 *
 * This test IS the lint. The web app has no CI; `vp test` runs in the `ready` lane, so the
 * token discipline that held by review during the sweep now holds by assertion. It encodes the
 * census gates driven to zero in the one-system design sweep (closed 2026-08-16; see the
 * Enforcement lines in docs/features/design-system/LEDGER.md). It walks src/**\/*.{ts,tsx,css} once with plain
 * regexes; the route ratchet uses TypeScript AST plus a narrow utility regex.
 *
 * ── HARD ZERO (any occurrence fails) ────────────────────────────────────────────────────────
 *  1. deleted tokens      var(--st-* --act-* --cat-* --pe-blue* --pe-green --paper* --mist
 *                        --basalt --slate --lens-ink-2 --clay* --kiln --lichen --fail --user*
 *                        --pea-tint --pea-line --line-soft). The GROUND FLIP ruling: the old
 *                        vocabulary has ZERO consumers and never grows one back — the
 *                        old vocabulary is deleted, so consuming it is consuming nothing.
 *  2. bare hairlines     var(--line) / var(--line-2). The canon hairlines are --pe-line /
 *                        --pe-line-2 (base.css); the bare names died with the Lens
 *                        vocabulary. (The regex is literal, so var(--pe-line) never matches.)
 *  3. tele classes       tele / tele-label / section-label as class words. The TYPE TIERS
 *                        ruling: tier x face x case replaced
 *                        the tele bundles, deleted 2026-08-16. Comments are stripped first;
 *                        lang's `dl-section-label` is a different word and stays legal.
 *  4. hex literals       #rrggbb / #rrggbbaa outside base.css. THE LAW in the canon
 *                        header: "no component, no route, and no CSS file downstream may name
 *                        a colour literal" — a colour is a one-line edit in base.css.
 *  5. sub-10px type      text-[Npx] with N < 10. The 10px floor from the type-tier ruling
 *                        (ops enforced it on itself; the flagship pass finished the job).
 *  6. shadows            shadow-* utilities. Depth is ground shift plus hairline.
 *  7. shadcn aliases     the 19 retired custom-property and utility names.
 *  8. legacy prefix      any --r- string. House custom properties use --pe-*.
 *
 * ── RATCHET (count may only fall; baselines in design-guard.baseline.json) ─────────────────
 *  appArbitrary      literal arbitrary Tailwind utilities across production TSX.
 *  routeRoleColor    role colour utilities in shipping route files.
 *  textPx           any text-[Npx]: off-tier type. The tier system (t-* classes) is the scale;
 *                   the remaining spends are exhibit chrome + a few audited sites.
 *  rawButton        <button> outside components/mechanism + components/lang: verbs come from
 *                   lang/Verb; the tail is non-verb machinery.
 *  mechanismButtonImports  import sites of mechanism/button — the still-open half; each route
 *                   pass that migrates a consumer lowers this until the file is deleted.
 *  dashed           border-dashed / stroke-dasharray / border-style: dashed outside
 *                   components/lang + base.css + design-lang.css. R13b: every broken-edge mechanism
 *                   occupies the SAME slot and means SEAM. The baseline covers the audited
 *                   deliberate spends (exhibit chrome, drawing-set's seam, atlas's legend).
 *  longTitle        title= props over 240 characters — the hover-shadow-doc ratchet from fit
 *                   review B·5: prose moved out of sight instead of deleted. May only shrink.
 *
 *  Prototype code is EXEMPT from the walk (any directory whose name starts with `proto`, and
 *  any `routes/<name>-proto.tsx`): the
 *  ratchets cannot tell a prototype from a shipping route, and a guard red from throwaway code
 *  proves nothing about the change in front of you. The promotion pass moves the winner out of
 *  `proto/`, which is what re-arms the ratchets for it. Decided 2026-08-19, family review round 1.
 *
 *  A count ABOVE its baseline fails with the offending files. A count BELOW its baseline also
 *  fails — asking you to lower the baseline — because a ratchet that can silently slacken is
 *  not a ratchet. Update src/design-guard.baseline.json in the same commit as the win.
 * =============================================================================================
 */
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  createSourceFile,
  forEachChild,
  isIdentifier,
  isJsxAttribute,
  isJsxElement,
  isJsxExpression,
  isJsxSelfClosingElement,
  isNoSubstitutionTemplateLiteral,
  isStringLiteral,
  isTemplateExpression,
  ScriptKind,
  ScriptTarget,
} from "typescript";
import { describe, expect, it } from "vite-plus/test";

// ── the walk ─────────────────────────────────────────────────────────────────────────────────

const GUARD_ROOT = dirname(fileURLToPath(import.meta.url)); // …/tests/repo-guards/src
const ROOT = resolve(GUARD_ROOT, "../../../apps/web/src");
const REPORT = resolve(
  GUARD_ROOT,
  "../../../../../docs/features/design-system/NORMALIZATION-2026-08-27.html",
);
const SKIP_DIRS = new Set([".artifacts", ".git", "build", "coverage", "dist", "node_modules"]);
const SKIP_FILES = new Set(["routeTree.gen.ts"]);

type Entry = { rel: string; text: string };

const collectCss = (dir: string, relBase: string, out: Entry[]): Entry[] => {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const rel = relBase === "" ? e.name : `${relBase}/${e.name}`;
    if (e.isDirectory()) {
      if (!SKIP_DIRS.has(e.name) && !e.name.startsWith("proto"))
        collectCss(join(dir, e.name), rel, out);
      continue;
    }
    if (SKIP_FILES.has(e.name)) continue;
    if (e.name.endsWith(".css")) out.push({ rel, text: readFileSync(join(dir, e.name), "utf8") });
  }
  return out;
};

const collectCode = (dir: string, relBase: string, out: Entry[]): Entry[] => {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const rel = relBase === "" ? e.name : `${relBase}/${e.name}`;
    if (e.isDirectory()) {
      if (!SKIP_DIRS.has(e.name) && !e.name.startsWith("proto"))
        collectCode(join(dir, e.name), rel, out);
      continue;
    }
    if (SKIP_FILES.has(e.name) || e.name.endsWith("-proto.tsx")) continue;
    if (/\.tsx?$/.test(e.name)) out.push({ rel, text: readFileSync(join(dir, e.name), "utf8") });
  }
  return out;
};

const CODE_FILES = collectCode(ROOT, "", []);
const CSS_FILES = collectCss(ROOT, "", []);
const FILES: Entry[] = [...CODE_FILES, ...CSS_FILES];

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

const CSS_SEAMS = new Set([
  "styles.css",
  "design-lang.css",
  "base.css",
  "components/lang/lang.css",
  "workbench/lens.css",
  "settings-panes/json-editor.css",
  "family-review/proto-editor/composed.css",
]);

const literalClassTexts = (
  initializer: import("typescript").JsxAttribute["initializer"],
): string[] => {
  if (!initializer) return [];
  const texts: string[] = [];
  const collectLiterals = (node: import("typescript").Node) => {
    if (isStringLiteral(node) || isNoSubstitutionTemplateLiteral(node)) {
      texts.push(node.text);
      return;
    }
    if (isTemplateExpression(node)) {
      texts.push(node.head.text);
      for (const span of node.templateSpans) {
        texts.push(span.literal.text);
        collectLiterals(span.expression);
      }
      return;
    }
    forEachChild(node, collectLiterals);
  };
  if (isStringLiteral(initializer) || isNoSubstitutionTemplateLiteral(initializer)) {
    return [initializer.text];
  }
  if (isJsxExpression(initializer) && initializer.expression)
    collectLiterals(initializer.expression);
  return texts;
};

const literalAuthoringTexts = (source: import("typescript").SourceFile) => {
  const nodes = new Map<string, import("typescript").Node>();
  const collect = (node: import("typescript").Node | undefined) => {
    if (!node) return;
    if (isStringLiteral(node) || isNoSubstitutionTemplateLiteral(node)) {
      nodes.set(`${node.pos}:${node.end}`, node);
      return;
    }
    if (isTemplateExpression(node)) {
      nodes.set(`${node.head.pos}:${node.head.end}`, node.head);
      for (const span of node.templateSpans) {
        nodes.set(`${span.literal.pos}:${span.literal.end}`, span.literal);
        collect(span.expression);
      }
      return;
    }
    forEachChild(node, collect);
  };
  collect(source);
  return [...nodes.values()].map((node) => ({
    text: (node as unknown as { text: string }).text,
    index: node.getStart(source),
  }));
};

const appArbitrary = (): Offence[] => {
  const offences: Offence[] = [];
  for (const f of FILES.filter((file) => file.rel.endsWith(".tsx"))) {
    const sf = createSourceFile(f.rel, f.text, ScriptTarget.Latest, true, ScriptKind.TSX);
    const visit = (node: import("typescript").Node) => {
      if (isJsxElement(node) || isJsxSelfClosingElement(node)) {
        const attributes = isJsxElement(node)
          ? node.openingElement.attributes.properties
          : node.attributes.properties;
        for (const attribute of attributes) {
          if (
            !isJsxAttribute(attribute) ||
            !isIdentifier(attribute.name) ||
            (attribute.name.text !== "className" && attribute.name.text !== "class")
          )
            continue;
          for (const text of literalClassTexts(attribute.initializer)) {
            for (const match of arbitraryUtilityTokens(text)) {
              offences.push({
                rel: f.rel,
                line: lineOf(f.text, node.getStart(sf)),
                match,
              });
            }
          }
        }
      }
      forEachChild(node, visit);
    };
    visit(sf);
  }
  return offences;
};

const arbitraryUtilityTokens = (text: string) => {
  const re =
    /(?:^|\s)((?:(?:[^\s:]+|\[[^\]]+\]):)*(?:text|bg|border|rounded|ring|shadow|p|px|py|pt|pr|pb|pl|m|mx|my|mt|mr|mb|ml|gap|space-[xy]|w|h|min-w|max-w|min-h|max-h|leading|tracking|font|top|right|bottom|left|inset|translate-x|translate-y|opacity|z)-\[[^\s\]]+\])/g;
  return [...text.matchAll(re)].map((match) => match[1]);
};

const semanticRoles = new Set([
  "page",
  "artifact",
  "recess",
  "select",
  "ink",
  "ink-2",
  "ink-mute",
  "line",
  "line-2",
  "pea",
  "pea-ink",
  "alarm",
  "caution",
  "done",
  "commit",
  "on-commit",
  "nav",
]);

const colorUtilityPrefix =
  "(?:bg|text|border(?:-[xysetrbl])?|divide|ring|outline|fill|stroke|caret|decoration|from|via|to|ring-offset)";
const roleNames = [...semanticRoles].sort((a, b) => b.length - a.length).join("|");
const roleColorUtilityRe = new RegExp(
  `(?<![-\\w])${colorUtilityPrefix}-(?:${roleNames})(?![-\\w])`,
  "g",
);
const shadcnAliasNames = [
  "background",
  "foreground",
  "card",
  "card-foreground",
  "popover",
  "popover-foreground",
  "primary",
  "primary-foreground",
  "secondary",
  "secondary-foreground",
  "muted",
  "muted-foreground",
  "accent",
  "accent-foreground",
  "destructive",
  "destructive-foreground",
  "border",
  "input",
  "ring",
]
  .sort((a, b) => b.length - a.length)
  .join("|");
const shadcnAliasRe = new RegExp(
  `--(?:color-)?(?:${shadcnAliasNames})(?![-\\w])|(?<![-\\w])${colorUtilityPrefix}-(?:${shadcnAliasNames})(?![-\\w])`,
  "g",
);

const stripVariantPrefix = (token: string) => {
  let brackets = 0;
  for (let i = token.length - 1; i >= 0; i -= 1) {
    if (token[i] === "]") brackets += 1;
    else if (token[i] === "[") brackets -= 1;
    else if (token[i] === ":" && brackets === 0) return token.slice(i + 1);
  }
  return token;
};

const isSemanticRawUtility = (rawToken: string) => {
  const token = rawToken
    .replace(/^["'`“”‘’]+/, "")
    .replace(/["'`“”‘’.,;:]+$/, "")
    .replace(/^\((.*)\)$/, "$1")
    .replace(/^!/, "");
  const utility = stripVariantPrefix(token).replace(/^!/, "").replace(/!$/, "");
  const color =
    /^(?:bg|text|border|divide|ring|outline|fill|stroke)(?:-[A-Za-z0-9_-]+)*-(\[(?:[A-Za-z][A-Za-z0-9_-]*:)?var\(--pe-([a-z0-9-]+)\)\]|\(--pe-([a-z0-9-]+)\))(?:\/[^\s]+)?$/.exec(
      utility,
    );
  if (color && semanticRoles.has(color[2] ?? color[3])) return true;
  if (/^rounded-(?:\[var\(--radius\)\]|\(--radius\))$/.test(utility)) return true;
  return /^font-\[family-name:var\(--font-pe-(?:mono|display)\)\]$/.test(utility);
};

const semanticRawUtilityTokens = (text: string) =>
  text.split(/\s+/).filter((token) => token && isSemanticRawUtility(token));

const semanticRawUtilityMatrix = [
  ["bg-[var(--pe-page)]", true],
  ["data-[s=idle]:bg-[var(--pe-page)]", true],
  ["[&:not(:first-child)]:bg-[var(--pe-page)]", true],
  ["border-r-[var(--pe-line)]/50", true],
  ["!bg-[var(--pe-page)]", true],
  ["bg-[var(--pe-page)]!", true],
  ["bg-[color:var(--pe-page)]", true],
  ["bg-(--pe-page)", true],
  ["rounded-[var(--radius)]", true],
  ["hover:rounded-(--radius)!", true],
  ["font-[family-name:var(--font-pe-mono)]", true],
  ['Use "bg-[var(--pe-page)]" here.', true],
  ["Use (bg-[var(--pe-page)]) here.", true],
  ["var(--pe-page)", false],
  ["color: var(--pe-page)", false],
  ["[--pe-on:var(--pe-page)]", false],
  ["hover:[background-image:linear-gradient(var(--pe-veil),var(--pe-veil))]", false],
  ["w-[var(--pe-page)]", false],
] as const;

const semanticRawUtilities = (): Offence[] => {
  const offences: Offence[] = [];
  for (const file of FILES.filter((entry) => /\.tsx?$/.test(entry.rel))) {
    const source = createSourceFile(file.rel, file.text, ScriptTarget.Latest, true, ScriptKind.TSX);
    for (const literal of literalAuthoringTexts(source)) {
      for (const token of semanticRawUtilityTokens(literal.text)) {
        offences.push({
          rel: file.rel,
          line: lineOf(file.text, literal.index),
          match: token,
        });
      }
    }
  }
  return offences;
};

// ── hard zeros ───────────────────────────────────────────────────────────────────────────────

describe("design guard — hard zeros", () => {
  it("no eligible PE semantic token arbitrary utilities remain in production literals", () => {
    expect(
      semanticRawUtilities(),
      "Deprecated raw PE utility spellings are forbidden in every production literal, including quoted examples; use the canonical semantic Tailwind role",
    ).toEqual([]);
  });

  it("matches the complete deprecated raw-token spelling matrix", () => {
    for (const [text, forbidden] of semanticRawUtilityMatrix) {
      expect(semanticRawUtilityTokens(text).length > 0, text).toBe(forbidden);
    }
  });

  it("no deleted token vocabulary is consumed (zero consumers, forever)", () => {
    const re =
      /var\(--(?:st-|act-|cat-|pe-blue|pe-green|paper|mist|basalt|slate|lens-ink-2|clay|kiln|lichen|fail|user|pea-tint|pea-line|line-soft)/g;
    const offences = scan(FILES, re);
    expect(
      offences.length,
      `Deleted token vocabulary consumed — these were removed at zero consumers; use the --pe-* canon (base.css):\n${report(offences)}`,
    ).toBe(0);
  });

  it("no bare var(--line) / var(--line-2) — the canon hairlines are --pe-line / --pe-line-2", () => {
    const re = /var\(--line(?:-2)?\s*[,)]/g;
    const offences = scan(FILES, re);
    expect(
      offences.length,
      `Bare hairline tokens — use var(--pe-line) / var(--pe-line-2):\n${report(offences)}`,
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

  it("no hex colour literal outside base.css (a colour is a one-line edit there)", () => {
    const re = /(?<![0-9a-fA-F])#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}(?:[0-9a-fA-F]{2})?)\b/g;
    const offences = scan(
      FILES.filter((f) => f.rel !== "base.css"),
      re,
    );
    expect(
      offences.length,
      `Colour literals outside the canon — name a --pe-* / --viz-* role instead:\n${report(offences)}`,
    ).toBe(0);
  });

  it("no sub-10px type (the 10px floor)", () => {
    const re = /text-\[[0-9]px\]/g;
    const offences = scan(FILES, re);
    expect(offences.length, `Type below the 10px floor:\n${report(offences)}`).toBe(0);
  });

  it("no shadow utilities (depth is ground shift plus hairline)", () => {
    const offences = scan(FILES, /(?<![-\w])shadow-[^\s"'<>]+/g);
    expect(offences.length, `Shadow utilities:\n${report(offences)}`).toBe(0);
  });

  it("no shadcn colour aliases", () => {
    const offences = scan(FILES, shadcnAliasRe);
    expect(offences.length, `Shadcn colour aliases:\n${report(offences)}`).toBe(0);
  });

  it("no legacy --r- custom-property spelling", () => {
    const offences = scan(FILES, /--r-/g);
    expect(offences.length, `Legacy --r- spelling:\n${report(offences)}`).toBe(0);
  });

  it("no bare PE token vars in governed TypeScript", () => {
    const offences = scan(
      CODE_FILES.filter((file) => file.rel !== "lib/token.ts"),
      /var\(--pe-/g,
    );
    expect(offences.length, `Bare PE token vars in TypeScript:\n${report(offences)}`).toBe(0);
  });

  it("no numeric or arbitrary z indexes in governed TypeScript", () => {
    const offences = scan(CODE_FILES, /(?<![-\w])z-(?:\[[^\]\s]+\]|\d+)(?![-\w])|\bzIndex\s*:/g);
    expect(offences.length, `Numeric z indexes:\n${report(offences)}`).toBe(0);
  });

  it("no duration utility except the motion token", () => {
    const offences = scan(CODE_FILES, /duration-(?!\(--motion\)(?![-\w]))/g);
    expect(offences.length, `Non-canonical duration utilities:\n${report(offences)}`).toBe(0);
  });

  it("no retired dl composition classes", () => {
    const offences = scan(FILES, /(?<![-\w])(?:dl-sq|dl-ghost|dl-cite|dl-spin|dl-tag)(?![-\w])/g);
    expect(offences.length, `Retired dl composition classes:\n${report(offences)}`).toBe(0);
  });

  it("every governed dl class still has a CSS selector", () => {
    const defined = new Set(
      CSS_FILES.flatMap((file) => [
        ...stripComments(file.text).matchAll(/\.((?:dl-)[a-z0-9-]+)(?![-\w])/g),
      ]).map((match) => match[1]),
    );
    const offences: Offence[] = [];
    for (const file of CODE_FILES) {
      const source = createSourceFile(file.rel, file.text, ScriptTarget.Latest, true, ScriptKind.TSX);
      for (const literal of literalAuthoringTexts(source)) {
        for (const match of literal.text.matchAll(/(?<![-\w])dl-[a-z0-9-]+(?![-\w])/g)) {
          if (!defined.has(match[0]))
            offences.push({
              rel: file.rel,
              line: lineOf(file.text, literal.index + (match.index ?? 0)),
              match: match[0],
            });
        }
      }
    }
    expect(offences, `Governed dl classes without CSS selectors:\n${report(offences)}`).toEqual([]);
  });
});

describe("design guard — foundation topology", () => {
  const directiveMatches = (text: string) => [
    ...text.matchAll(/^\s*@(import|plugin)\s+(?:url\([^)]*\)|["'][^"']+["']);/gm),
  ];

  const directiveRemainder = (text: string, matches: RegExpMatchArray[]) => {
    let remainder = stripComments(text);
    for (const match of [...matches].reverse()) {
      const start = match.index ?? 0;
      remainder = remainder.slice(0, start) + remainder.slice(start + match[0].length);
    }
    return remainder.trim();
  };

  const splitSelectors = (text: string): string[] => {
    const selectors: string[] = [];
    let start = 0;
    let depth = 0;
    for (let i = 0; i < text.length; i++) {
      if (text[i] === "(") depth++;
      if (text[i] === ")") depth--;
      if (text[i] === "," && depth === 0) {
        selectors.push(text.slice(start, i).trim());
        start = i + 1;
      }
    }
    selectors.push(text.slice(start).trim());
    return selectors.filter(Boolean);
  };

  const BASE_PROPERTY_ALLOWLIST: Record<string, string> = {
    "[data-pe]":
      "border-color outline-color min-height scrollbar-width scrollbar-color color-scheme",
    "[data-pe] *": "border-color outline-color",
    "[data-pe] body":
      "min-height margin background-color color font-family line-height -webkit-font-smoothing -moz-osx-font-smoothing",
    "[data-pe] #app": "min-height",
    "[data-pe].dark": "color-scheme",
    "[data-pe] :where(button, input, select, textarea)": "font",
    "[data-pe] :where(code, pre, kbd, samp)": "font-family",
    "[data-pe] :where(:focus-visible)": "outline outline-offset",
    "[data-pe] a": "color text-underline-offset",
    "[data-pe] a:hover": "text-decoration",
    "[data-pe] code": "font-size border background border-radius padding",
    "[data-pe] pre code": "border background padding border-radius font-size",
  };

  const basePropertyViolations = (layer: string): string[] => {
    const violations: string[] = [];
    for (const rule of layer.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      const properties = [...rule[2].matchAll(/(?:^|;)\s*([\w-]+)\s*:/g)].map((match) => match[1]);
      for (const selector of splitSelectors(rule[1])) {
        const allowed = BASE_PROPERTY_ALLOWLIST[selector]?.split(" ");
        if (!allowed) {
          violations.push(`${selector} (selector)`);
          continue;
        }
        for (const property of properties) {
          if (!allowed.includes(property)) violations.push(`${selector} -> ${property}`);
        }
      }
    }
    return violations;
  };

  it("keeps styles.css as the app entry and import order", () => {
    const entry = FILES.find((file) => file.rel === "styles.css");
    expect(entry, "styles.css must be collected").toBeDefined();
    const matches = directiveMatches(entry!.text);
    const directives = matches.map((match) => match[0].trim());
    expect(directives, "styles.css must keep the six ordered entry directives").toEqual([
      '@import url("https://fonts.googleapis.com/css2?family=Open+Sans:wght@400;500;600;700&family=Spectral:wght@500;600;700&display=swap");',
      '@import "tailwindcss";',
      "@plugin '@tailwindcss/typography';",
      '@import "tw-animate-css";',
      '@import "./base.css";',
      '@import "./design-lang.css";',
    ]);
    expect(directiveRemainder(entry!.text, matches), "styles.css has non-directive content").toBe(
      "",
    );
  });

  it("rejects declarations and unknown directives left in styles.css", () => {
    const entry = FILES.find((file) => file.rel === "styles.css");
    expect(entry).toBeDefined();
    const mutated = `${entry!.text}\n@source "./rogue";\nbody { display: block; }`;
    const matches = directiveMatches(mutated);
    expect(directiveRemainder(mutated, matches)).toContain('@source "./rogue";');
    expect(directiveRemainder(mutated, matches)).toContain("body { display: block; }");
  });

  it("keeps the browser base flat, scoped, and separate from Tailwind", () => {
    const base = CSS_FILES.find((file) => file.rel === "base.css");
    expect(base, "base.css must be collected").toBeDefined();
    const text = stripComments(base!.text);
    expect(text).not.toMatch(/@(apply|theme|utility|custom-variant|plugin)\b/);
    expect(text).not.toMatch(
      /@import\b|tailwindcss|tw-animate|url\(|<script\b|animation(?:-name)?\s*:/i,
    );
    const baseLayer = /@layer base\s*\{([\s\S]*?)\n\}\s*\n\[data-pe\] \.page-wrap/.exec(text);
    expect(baseLayer, "base.css defaults must remain inside native @layer base").toBeTruthy();
    expect((text.match(/@layer base\b/g) ?? []).length).toBe(1);
    expect(baseLayer![1]).toContain("[data-pe] pre code");
    expect(baseLayer![1]).toContain("font-family: var(--font-body);");
    expect(baseLayer![1]).toContain("line-height: 1.5;");
    expect(baseLayer![1]).toContain("font: inherit;");
    expect(baseLayer![1]).toContain("font-family: var(--font-mono);");
    expect(baseLayer![1]).toContain("outline: 2px solid var(--pe-ink);");
    expect(baseLayer![1]).toContain("color-scheme: light;");
    expect(baseLayer![1]).toContain("[data-pe].dark");
    expect(baseLayer![1]).not.toContain("\\");
    expect(text).not.toMatch(/(?:^|\n)\s*:root\s*\{[^}]*color-scheme:/);
    expect(text).not.toMatch(/(?:^|\n)\s*\.dark\s*\{[^}]*color-scheme:/);
    expect(basePropertyViolations(baseLayer![1])).toEqual([]);
  });

  it("rejects form-control component skins in the browser base", () => {
    const base = CSS_FILES.find((file) => file.rel === "base.css");
    expect(base).toBeDefined();
    const mutated = base!.text.replace(
      "font: inherit;",
      "font: inherit;\n    padding: 2rem;\n    background: var(--pe-commit);\n    border-radius: 999px;",
    );
    const layer = /@layer base\s*\{([\s\S]*?)\n\}\s*\n\[data-pe\] \.page-wrap/.exec(
      stripComments(mutated),
    );
    expect(layer).toBeTruthy();
    expect(basePropertyViolations(layer![1])).toEqual(
      expect.arrayContaining([
        "[data-pe] :where(button, input, select, textarea) -> padding",
        "[data-pe] :where(button, input, select, textarea) -> background",
        "[data-pe] :where(button, input, select, textarea) -> border-radius",
      ]),
    );

    const escaped = base!.text.replace(
      "font: inherit;",
      "font: inherit;\n    padd\\69ng: 2rem;\n    back\\67round: var(--pe-commit);\n    border-rad\\69us: 999px;",
    );
    const escapedLayer = /@layer base\s*\{([\s\S]*?)\n\}\s*\n\[data-pe\] \.page-wrap/.exec(
      stripComments(escaped),
    );
    expect(escapedLayer).toBeTruthy();
    expect(basePropertyViolations(escapedLayer![1])).toEqual([]);
    expect(() => expect(escapedLayer![1]).not.toContain("\\")).toThrow();
  });

  it("keeps PE raw authority in base.css and embeds that exact source in the report", () => {
    const base = CSS_FILES.find((file) => file.rel === "base.css");
    const lang = CSS_FILES.find((file) => file.rel === "design-lang.css");
    expect(base).toBeDefined();
    expect(lang).toBeDefined();
    expect(lang!.text).not.toMatch(/^\s*--(?:r-|viz-)/m);
    expect(lang!.text).not.toContain("[data-pe]");
    const reportText = readFileSync(REPORT, "utf8");
    const embedded = /<style id="pe-base">([\s\S]*?)<\/style>/.exec(reportText);
    expect(embedded, "report must contain the exact base.css embedding").toBeTruthy();
    expect(embedded![1]).toBe(base!.text);
  });

  it("exempts prototype directories and *-proto.tsx files", () => {
    expect(
      FILES.filter(
        (file) =>
          file.rel.split("/").some((part) => part.startsWith("proto")) ||
          file.rel.endsWith("-proto.tsx"),
      ),
    ).toEqual([]);
  });

  it("counts variant-prefixed arbitrary route utilities", () => {
    expect(arbitraryUtilityTokens("sm:max-w-[44rem]")).toEqual(["sm:max-w-[44rem]"]);
  });

  it("collects template substitution literals exactly once", () => {
    const source = createSourceFile(
      "template-regression.tsx",
      '<div className={`p-[1px] ${ok ? "m-[2px]" : ""} h-[3px]`} />',
      ScriptTarget.Latest,
      true,
      ScriptKind.TSX,
    );
    let initializer: import("typescript").JsxAttribute["initializer"];
    const visit = (node: import("typescript").Node) => {
      if (isJsxAttribute(node) && isIdentifier(node.name) && node.name.text === "className") {
        initializer = node.initializer;
      }
      forEachChild(node, visit);
    };
    visit(source);
    expect(literalClassTexts(initializer)).toEqual(["p-[1px] ", " h-[3px]", "m-[2px]", ""]);
  });

  it("sees class-builder literals inside JSX prop descendants once", () => {
    const source = createSourceFile(
      "nested-prop-regression.tsx",
      '<Panel sentence={<span className={cn("text-[var(--pe-ink)]")} />} />',
      ScriptTarget.Latest,
      true,
      ScriptKind.TSX,
    );
    expect(literalAuthoringTexts(source).map((literal) => literal.text)).toEqual([
      "text-[var(--pe-ink)]",
    ]);
  });

  it("keeps CSS declarations inside the explicit foundation seams", () => {
    const declarationRe = /(?<![-\w])[-a-zA-Z][\w-]*\s*:\s*[^;{}]+;/g;
    const outside = CSS_FILES.filter((file) => !CSS_SEAMS.has(file.rel)).map((file) => ({
      ...file,
      text: stripComments(file.text),
    }));
    expect(scan(outside, declarationRe), "CSS declarations outside the foundation seams").toEqual(
      [],
    );
  });
});

// ── ratchets ─────────────────────────────────────────────────────────────────────────────────

type Baseline = Record<string, number>;
const BASELINE: Baseline = JSON.parse(
  readFileSync(join(GUARD_ROOT, "design-guard.baseline.json"), "utf8"),
);

const isTsx = (f: Entry) => f.rel.endsWith(".tsx");
const inMechanismOrLang = (f: Entry) =>
  f.rel.startsWith("components/mechanism/") || f.rel.startsWith("components/lang/");

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
  it("appArbitrary — literal arbitrary Tailwind utilities across the app", () => {
    ratchet("appArbitrary", appArbitrary());
  });

  it("langCssLines ratchets the surviving component stylesheet", () => {
    const langCss = CSS_FILES.find((file) => file.rel === "components/lang/lang.css");
    expect(langCss).toBeDefined();
    const count = langCss!.text.replace(/\r\n/g, "\n").replace(/\n$/, "").split("\n").length;
    const base = BASELINE.langCssLines;
    if (count > base) expect.fail(`RATCHET "langCssLines" grew: ${count} > baseline ${base}.`);
    if (count < base)
      expect.fail(
        `RATCHET "langCssLines" fell: ${count} < baseline ${base}. Lower "langCssLines" to ${count}.`,
      );
  });

  it("routeRoleColor — role colour utilities in shipping routes", () => {
    ratchet(
      "routeRoleColor",
      scan(
        FILES.filter((file) => file.rel.startsWith("routes/")),
        roleColorUtilityRe,
      ),
    );
  });

  it("textPx — arbitrary text-[Npx] off the tier ladder", () => {
    ratchet("textPx", scan(FILES, /text-\[\d+px\]/g));
  });

  it("rawButton — <button> outside components/mechanism + components/lang", () => {
    ratchet(
      "rawButton",
      scan(
        FILES.filter((f) => isTsx(f) && !inMechanismOrLang(f)),
        /<button\b/g,
      ),
    );
  });

  it("mechanismButtonImports — open tail; falls to 0 when mechanism/button dies", () => {
    ratchet("mechanismButtonImports", scan(FILES, /from\s+["'][^"']*mechanism\/button["']/g));
  });

  it("dashed — broken-edge mechanisms outside lang (R13b: dashed means SEAM, one slot)", () => {
    ratchet(
      "dashed",
      scan(
        FILES.filter(
          (f) => !inMechanismOrLang(f) && f.rel !== "base.css" && f.rel !== "design-lang.css",
        ),
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
