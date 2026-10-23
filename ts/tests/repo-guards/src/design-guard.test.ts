import { readdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, posix, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import ts from "../../../apps/web/node_modules/typescript/lib/typescript.js";
import { describe, expect, it } from "vite-plus/test";

// ── the walk ─────────────────────────────────────────────────────────────────────────────────

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "../../../apps/web/src");
const KIT_ROOT = resolve(HERE, "../../../packages/kit/src");
const SKIP_DIRS = new Set(["node_modules", "src"]); // src/src is a stray vite artifact
/* revit/revit.css is the Revit facsimile (explainers compose fake Revit UI without images). It is
   off-system on purpose and draws every value from the --rv-* block in base.css, so the house value
   rules do not apply to it; its classes still register through styles.css, and its TSX is scanned.
   Ruling: docs/features/design-system/LEDGER.md, "Revit facsimile" (2026-10-05). */
const SKIP_FILES = new Set(["routeTree.gen.ts", "revit.css"]);

type Entry = { rel: string; text: string; abs?: string };

const collect = (dir: string, relBase: string, out: Entry[], match: RegExp): Entry[] => {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const rel = relBase === "" ? e.name : `${relBase}/${e.name}`;
    if (e.isDirectory()) {
      if (!SKIP_DIRS.has(e.name)) collect(join(dir, e.name), rel, out, match);
      continue;
    }
    if (SKIP_FILES.has(e.name)) continue;
    if (!match.test(e.name)) continue;
    out.push({ rel, abs: join(dir, e.name), text: readFileSync(join(dir, e.name), "utf8") });
  }
  return out;
};

const FILES: Entry[] = [
  ...collect(ROOT, "", [], /\.(?:tsx?|css)$/),
  ...collect(KIT_ROOT, "", [], /\.(?:tsx?|css)$/),
];

describe("design guard â€” current token authority", () => {
  it("has one source owner for every shared instrument path", () => {
    const paths = FILES.filter((file) =>
      /^(components\/|lib\/|base\.css$|design-lang\.css$)/.test(file.rel),
    ).map((file) => file.rel);
    expect(paths.filter((path, index) => paths.indexOf(path) !== index)).toEqual([]);
  });
  it("declares each authored class in one CSS owner", () => {
    const declarations = authoredOwners(
      [...LIVE_CSS].map((rel) => CSS_BY_REL.get(rel)!).filter(Boolean),
    );
    const duplicates = [...declarations]
      .filter(([, classOwners]) => classOwners.length > 1)
      .map(([name, classOwners]) => `${name}: ${classOwners.join(", ")}`)
      .sort();
    expect(duplicates).toEqual([]);
  });
});

type Offence = { rel: string; line: number; match: string };

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
  if (clean.startsWith("@pe/kit/lang/")) return clean.replace("@pe/kit/lang/", "components/lang/");
  if (clean.startsWith("@pe/kit/")) return clean.slice("@pe/kit/".length);
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

// Authored selectors only: generated Tailwind CSS and runtime styles are outside this check.
const splitSelectors = (text: string) => {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let index = 0; index < text.length; index++) {
    if ("([".includes(text[index])) depth++;
    else if (")]".includes(text[index])) depth--;
    else if (text[index] === "," && depth === 0) {
      parts.push(text.slice(start, index).trim());
      start = index + 1;
    }
  }
  return [...parts, text.slice(start).trim()];
};
const selectors = (css: string) =>
  [...stripComments(css).matchAll(/([^{}]+)\{/g)].flatMap((block) =>
    block[1].trim().startsWith("@") ? [] : splitSelectors(block[1]),
  );
const isOwnSelector = (selector: string) => {
  const match = /^(?:\[data-pe\]\s+)?\.([\w-]+)(.*)$/.exec(selector);
  // States and pseudo-elements specialize a class; descendant/child slots do not own it.
  return match && !/[ >+~]/.test(match[2].replace(/\[[^\]]*\]|\([^)]*\)/g, "")) ? match[1] : null;
};
// Reach owns shared state paint; resting component rules retain class ownership.
const REACH_STATE_OVERRIDES: Record<string, string> = {
  "dl-button": "Button hover and column-header interaction paint share the reach block.",
  "dl-cell": "Cell hover rings share the reach block.",
  "dl-verdict": "Verdict hover and focus paint share the reach block.",
};
const authoredOwners = (files: Entry[]) => {
  const owners = new Map<string, string[]>();
  for (const file of files) {
    const stateOnlyOwners: string[] = [];
    const ownershipSource =
      file.rel === "components/lang/lang.css"
        ? file.text.replace(/\/\* REACH START[\s\S]*?\/\* REACH END \*\//g, (block) => {
            const stateOwners = [
              ...new Set(
                selectors(block)
                  .map(isOwnSelector)
                  .filter((name): name is string => !!name),
              ),
            ];
            expect(stateOwners.filter((name) => REACH_STATE_OVERRIDES[name]).sort()).toEqual(
              Object.keys(REACH_STATE_OVERRIDES).sort(),
            );
            stateOnlyOwners.push(...stateOwners.filter((name) => !REACH_STATE_OVERRIDES[name]));
            return "";
          })
        : file.text;
    const names = new Set([
      ...stateOnlyOwners,
      ...selectors(ownershipSource)
        .map(isOwnSelector)
        .filter((name): name is string => !!name),
      ...[...stripComments(ownershipSource).matchAll(/@utility\s+([\w-]+)/g)].map(
        (match) => match[1],
      ),
    ]);
    for (const name of names) owners.set(name, [...(owners.get(name) ?? []), file.rel]);
  }
  return owners;
};

// Scoped composition is deliberate. Every file/class pair carries its own reason.
const CONTEXTUAL_OVERRIDES: Record<string, string> = {
  "components/lang/conversation.css:dl-button": "Composer buttons align with its input baseline.",
  "components/lang/hotkey-command.css:dl-button": "Command button reserves its chord affordance.",
  "navigation/app-bar.css:dl-button": "App bar and settings control geometry follows its rail.",
  "navigation/app-bar.css:dl-hotkey-command":
    "App bar commands and settings align their shortcut trail.",
  "workbench/lens.css:prose-pe": "Transcript prose fits the shared chat reading measure.",
  "workbench/lens.css:dl-composer-frame": "Chat surface composer shares the transcript inset.",
  "workbench/lens.css:dl-composer-box": "Chat surface composer shares the transcript measure.",
  "workbench/lens.css:dl-message-body": "An in-run message aligns with the run lane.",
  "workbench/lens.css:dl-message-bubble": "Chat bubbles use the transcript plane.",
  "workbench/lens.css:dl-tool-status": "Tool status fits the timeline marker.",
  "components/lang/navigation.css:dl-row": "Navigation supplies its pane inset and active state.",
  "components/lang/navigation.css:dl-row-label":
    "Title and unread weight use the navigation text edge.",
  "components/lang/navigation.css:dl-row-sub": "Secondary text carries words and tabular ages.",
  "components/lang/navigation.css:dl-row-eyebrow": "Eyebrow text carries words and tabular ages.",
  "components/lang/navigation.css:dl-row-meta": "Metadata carries words and tabular ages.",
  "components/lang/navigation.css:dl-row-lead":
    "Title/target rows align their lead to the first line.",
  "chat/thread-navigation.css:dl-row": "Thread sidebar supplies its pane inset.",
  "chat/thread-navigation.css:dl-row-sub": "Thread secondary text uses body face and tabular ages.",
  "chat/thread-navigation.css:dl-row-meta": "Thread metadata uses body face and tabular ages.",
};

describe("CSS ownership across the compiled entry graph", () => {
  it("requires a reason for every contextual override of kit vocabulary", () => {
    const kitFiles = [...LIVE_CSS]
      .map((rel) => CSS_BY_REL.get(rel)!)
      .filter(
        (file) =>
          file && (file.abs?.startsWith(KIT_ROOT) || file.rel.startsWith("components/lang/")),
      );
    const sharedOwners = authoredOwners(kitFiles);
    const kitClasses = new Set(sharedOwners.keys());
    const overrides = new Set<string>();
    for (const rel of LIVE_CSS) {
      const file = CSS_BY_REL.get(rel);
      if (!file || file.abs?.startsWith(KIT_ROOT)) continue;
      for (const selector of selectors(file.text)) {
        if (isOwnSelector(selector)) continue;
        for (const match of selector.matchAll(/\.([\w-]+)/g)) {
          if (kitClasses.has(match[1]) && !sharedOwners.get(match[1])?.includes(rel))
            overrides.add(`${rel}:${match[1]}`);
        }
      }
    }
    expect([...overrides].filter((key) => !CONTEXTUAL_OVERRIDES[key]).sort()).toEqual([]);
    expect(
      Object.keys(CONTEXTUAL_OVERRIDES)
        .filter((key) => !overrides.has(key))
        .sort(),
    ).toEqual([]);
  });
  it("rejects duplicate owners even in route entries and through CSS imports", () => {
    expect(
      authoredOwners([{ rel: "route.css", text: ".route :is(.sample, .other) {}" }]).size,
    ).toBe(0);
    expect(
      authoredOwners([
        { rel: "kit.css", text: ".sample {}" },
        { rel: "route.css", text: "@media (width > 1px) { .sample[data-active] {} }" },
      ]).get("sample"),
    ).toEqual(["kit.css", "route.css"]);
  });
});

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
  .map(
    (rel) =>
      `@import "./${relative(ROOT, FILES.find((file) => file.rel === rel)!.abs!).replace(/\\/g, "/")}";`,
  )
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
  "t-small",
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

describe("design checks — code holds the boundary", () => {
  it("loads the app CSS graph before checking candidates", () => {
    expect(LOADER_PRESENT.filter((candidate) => !registered.has(candidate))).toEqual([]);
    expect(LOADER_ABSENT.filter((candidate) => registered.has(candidate))).toEqual([]);
  });

  it(`unregistered classes — hard zero (${TRUE_UNREGISTERED.length} true unregistered)`, () => {
    expect(
      TRUE_UNREGISTERED,
      report(TRUE_UNREGISTERED.map((o) => ({ ...o, match: o.token }))),
    ).toEqual([]);
  });
});
