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
 *  1. dead-shim tokens   var(--st-* --act-* --cat-* --pe-blue* --pe-green --paper* --mist
 *                        --basalt --slate --lens-ink-2 --clay* --kiln --lichen --fail --user*
 *                        --pea-tint --pea-line --line-soft). The GROUND FLIP ruling: the alias
 *                        shim in styles.css reads ZERO lines and never grows one back — the
 *                        old vocabulary is deleted, so consuming it is consuming nothing.
 *  2. bare hairlines     var(--line) / var(--line-2). The canon hairlines are --r-line /
 *                        --r-line-2 (design-lang.css); the bare names died with the Lens
 *                        vocabulary. (The regex is literal, so var(--r-line) never matches.)
 *  3. tele classes       tele / tele-label / section-label as class words. The TYPE TIERS
 *                        ruling: tier x face x case replaced
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
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  createSourceFile,
  forEachChild,
  isIdentifier,
  isImportDeclaration,
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
const SKIP_DIRS = new Set([".artifacts", ".git", "build", "coverage", "dist", "node_modules"]);
const SKIP_FILES = new Set(["routeTree.gen.ts"]);

type Entry = { rel: string; text: string };

const collectCss = (dir: string, relBase: string, out: Entry[]): Entry[] => {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const rel = relBase === "" ? e.name : `${relBase}/${e.name}`;
    if (e.isDirectory()) {
      if (!SKIP_DIRS.has(e.name)) collectCss(join(dir, e.name), rel, out);
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

const CSS_FILES = collectCss(ROOT, "", []);
const FILES: Entry[] = [...collectCode(ROOT, "", []), ...CSS_FILES];
const ROUTE_TREE_TEXT = readFileSync(join(ROOT, "routeTree.gen.ts"), "utf8");

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
  "design-defaults.css",
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

const MOUNTED_ROUTE_FILES = (() => {
  const mounted = new Set<string>();
  const routeTree = createSourceFile(
    "routeTree.gen.ts",
    ROUTE_TREE_TEXT,
    ScriptTarget.Latest,
    true,
    ScriptKind.TS,
  );
  const visit = (node: import("typescript").Node) => {
    if (isImportDeclaration(node) && isStringLiteral(node.moduleSpecifier)) {
      const specifier = node.moduleSpecifier.text;
      if (specifier.startsWith("./routes/")) {
        const rel = `${specifier.slice(2)}.tsx`;
        if (!rel.endsWith("-proto.tsx") && existsSync(resolve(ROOT, rel))) mounted.add(rel);
      }
    }
    forEachChild(node, visit);
  };
  visit(routeTree);
  return mounted;
})();

const routeArbitrary = (): Offence[] => {
  const re =
    /(?:^|\s)((?:text|bg|border|rounded|ring|shadow|p|px|py|pt|pr|pb|pl|m|mx|my|mt|mr|mb|ml|gap|space-[xy]|w|h|min-w|max-w|min-h|max-h|leading|tracking|font|top|right|bottom|left|inset|translate-x|translate-y|opacity|z)-\[[^\s\]]+\])/g;
  const offences: Offence[] = [];
  for (const f of FILES.filter((file) => MOUNTED_ROUTE_FILES.has(file.rel))) {
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
            re.lastIndex = 0;
            for (const match of text.matchAll(re)) {
              offences.push({
                rel: f.rel,
                line: lineOf(f.text, node.getStart(sf)),
                match: match[1],
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

const semanticRawUtilityRe =
  /(?:^|\s)((?:[^\s:]+:)*!?((?:bg|text|border|divide|ring|outline|fill|stroke)(?:-[A-Za-z0-9_-]+)*-\[var\(--r-(?:page|artifact|recess|select|ink|ink-2|ink-mute|line|line-2|pea|pea-ink|alarm|caution|done|commit|on-commit|nav)\)\](?:\/[^\s]+)?|rounded-\[var\(--radius\)\]|font-\[family-name:var\(--font-pe-(?:mono|display)\)\]))(?=\s|$)/g;

const semanticRawUtilities = (): Offence[] => {
  const offences: Offence[] = [];
  for (const file of FILES.filter((entry) => /\.tsx?$/.test(entry.rel))) {
    const source = createSourceFile(file.rel, file.text, ScriptTarget.Latest, true, ScriptKind.TSX);
    for (const literal of literalAuthoringTexts(source)) {
      semanticRawUtilityRe.lastIndex = 0;
      for (const match of literal.text.matchAll(semanticRawUtilityRe)) {
        offences.push({
          rel: file.rel,
          line: lineOf(file.text, literal.index + (match.index ?? 0)),
          match: match[1],
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
      "Use the existing literal semantic Tailwind role in class attributes and class builders",
    ).toEqual([]);
  });

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
      '@import "./design-lang.css";',
      '@import "./design-defaults.css";',
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

  it("uses only route sources mounted by routeTree.gen.ts", () => {
    expect(MOUNTED_ROUTE_FILES.has("routes/index.tsx")).toBe(true);
    expect(MOUNTED_ROUTE_FILES.has("routes/__wave1b-unmounted.tsx")).toBe(false);
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
      '<Panel sentence={<span className={cn("text-[var(--r-ink)]")} />} />',
      ScriptTarget.Latest,
      true,
      ScriptKind.TSX,
    );
    expect(literalAuthoringTexts(source).map((literal) => literal.text)).toEqual([
      "text-[var(--r-ink)]",
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
  it("routeArbitrary — literal arbitrary Tailwind utilities in shipping routes", () => {
    ratchet("routeArbitrary", routeArbitrary());
  });

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

  it("uiButtonImports — open tail; falls to 0 when ui/button dies", () => {
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
