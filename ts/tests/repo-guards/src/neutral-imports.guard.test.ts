import { readFileSync, readdirSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { extname, join, resolve } from "node:path";
import { expect, test } from "vite-plus/test";
import ts from "typescript";
import { tmpdir } from "node:os";
const root = resolve(import.meta.dirname, "../../..");
const files = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.name === "node_modules"
      ? []
      : e.isDirectory()
        ? files(join(dir, e.name))
        : e.name === "neutral.ts" || e.name.endsWith(".neutral.ts")
          ? [join(dir, e.name)]
          : [],
  );
// Let the owning compiler resolve imports; this guard only checks reachable runtime edges.
const config = ts.readConfigFile(join(root, "apps/web/tsconfig.json"), ts.sys.readFile);
const options = ts.parseJsonConfigFileContent(config.config, ts.sys, join(root, "apps/web")).options;
const runtimeImports = (source: ts.SourceFile) => {
  const imports: string[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      const clause = node.importClause;
      const names = clause?.namedBindings;
      if (!clause?.isTypeOnly && !(!clause?.name && names && ts.isNamedImports(names) &&
          names.elements.length && names.elements.every((name) => name.isTypeOnly)))
        imports.push(node.moduleSpecifier.text);
    } else if (ts.isExportDeclaration(node) && !node.isTypeOnly && node.moduleSpecifier &&
        ts.isStringLiteral(node.moduleSpecifier)) {
      const names = node.exportClause;
      if (!(names && ts.isNamedExports(names) && names.elements.length &&
          names.elements.every((name) => name.isTypeOnly))) imports.push(node.moduleSpecifier.text);
    } else if (ts.isCallExpression(node) &&
        (node.expression.kind === ts.SyntaxKind.ImportKeyword || node.expression.getText(source) === "require") &&
        node.arguments[0] && ts.isStringLiteral(node.arguments[0])) imports.push(node.arguments[0].text);
    ts.forEachChild(node, visit);
  };
  visit(source);
  return imports;
};
function forbidden(file: string, seen = new Set<string>()): string[] {
  file = ts.sys.realpath?.(file) ?? file;
  if (seen.has(file)) return [];
  seen.add(file);
  const source = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true);
  const found: string[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node) || ts.isJsxFragment(node))
      found.push(`${file}: JSX`);
    else ts.forEachChild(node, visit);
  };
  visit(source);
  for (const specifier of runtimeImports(source)) {
    const target = ts.resolveModuleName(specifier, file, options, ts.sys).resolvedModule?.resolvedFileName;
    if (/^(?:react(?:-dom)?(?:\/|$)|@tanstack\/react-)|\.(?:css|scss|less)$/.test(specifier) ||
        target?.replaceAll("\\", "/").endsWith("/apps/web/src/host/runtime.ts"))
      found.push(`${file}: ${specifier}`);
    else if (target && !/\.d\.[cm]?ts$/.test(target) && !target.endsWith(".json"))
      found.push(...forbidden(target, seen));
  }
  return found;
}

test("neutral runtime closures never reach UI, React, host runtime or styles", () => {
  // One visited set across roots: an edge reached from two neutral modules is one offender.
  const seen = new Set<string>();
  expect(files(join(root, "apps")).flatMap((file) => forbidden(file, seen))).toEqual([]);
});

const extensionlessImports = (source: string) =>
  ts
    .preProcessFile(source, true, true)
    .importedFiles.map(({ fileName }) => fileName)
    .filter((fileName) => fileName.startsWith(".") && !extname(fileName));

test("neutral modules use explicit extensions for relative imports", () => {
  expect(
    files(join(root, "apps")).flatMap((file) =>
      extensionlessImports(readFileSync(file, "utf8")).map((specifier) => `${file}: ${specifier}`),
    ),
  ).toEqual([]);
});

test.each([
  'import { value } from "./value";',
  'import type { Value } from "../value";',
  'export * from "./value";',
  'const value = import("./value");',
])("rejects extensionless neutral dependency: %s", (source) => {
  expect(extensionlessImports(source)).toHaveLength(1);
  expect(extensionlessImports(source.replace('value"', 'value.ts"'))).toEqual([]);
});

test("ordinary filenames are neutral until a transitive runtime edge reaches UI", () => {
  const dir = mkdtempSync(join(tmpdir(), "neutral-closure-"));
  try {
    const entry = join(dir, "entry.neutral.ts"), middle = join(dir, "ordinary.ts");
    writeFileSync(entry, 'export { value } from "./ordinary.ts";');
    writeFileSync(middle, 'import type { ReactNode } from "react"; export const value = 1;');
    expect(forbidden(entry)).toEqual([]);
    writeFileSync(middle, 'import React, { type ReactNode } from "react"; export const value = React;');
    expect(forbidden(entry)).toEqual([expect.stringMatching(/ordinary\.ts: react$/)]);
    writeFileSync(middle, 'export { value } from "./leaf.ts";');
    writeFileSync(join(dir, "leaf.ts"), 'const value = import("react"); export { value };');
    expect(forbidden(entry)).toEqual([expect.stringMatching(/leaf\.ts: react$/)]);
    // JSX is syntax, independent of the module filename taxonomy.
    writeFileSync(middle, 'export { value } from "./leaf.tsx";');
    writeFileSync(join(dir, "leaf.tsx"), 'export const value = <div />;');
    expect(forbidden(entry)).toEqual([expect.stringMatching(/leaf\.tsx: JSX$/)]);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
