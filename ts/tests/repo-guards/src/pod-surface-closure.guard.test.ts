import { existsSync, readFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import ts from "typescript";
import { expect, test } from "vite-plus/test";
import { ROOT, WEB } from "./import-census.ts";

// A Pod bundles the `@pe/web/route` surface (src/route/defaults.ts) and everything it reaches at
// runtime. The bundle test (apps/web/pod-surface.guard.test.ts) refuses effect, React and @pe/kit,
// but a shell module that needs none of them bundles silently; its old "Start this Work" text check
// left with SH-S6 (that wording is now public reasonOf). This walks the runtime imports instead.
const SURFACE = `${WEB}route/defaults.ts`;

/** Runtime module specifiers of one file: type-only imports and exports carry no code. */
function runtimeSpecifiers(text: string, path: string): string[] {
  const source = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true);
  const found: string[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      const clause = node.importClause;
      const bindings = clause?.namedBindings;
      const typeOnly = clause?.isTypeOnly ||
        (clause && !clause.name && bindings && ts.isNamedImports(bindings) && bindings.elements.every((b) => b.isTypeOnly));
      if (!typeOnly) found.push(node.moduleSpecifier.text);
    } else if (ts.isExportDeclaration(node) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
      if (!node.isTypeOnly) found.push(node.moduleSpecifier.text);
    } else if (
      ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword &&
      node.arguments[0] && ts.isStringLiteral(node.arguments[0])
    ) found.push(node.arguments[0].text);
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

/** The web files a surface reaches at runtime, through relative and `#/` imports. */
export function runtimeClosure(entry: string, read: (path: string) => string | null): string[] {
  const seen = new Set<string>();
  const todo = [entry];
  for (let file = todo.pop(); file !== undefined; file = todo.pop()) {
    if (seen.has(file)) continue;
    seen.add(file);
    const text = read(file);
    if (text === null) continue;
    for (const specifier of runtimeSpecifiers(text, file)) {
      if (!specifier.startsWith(".") && !specifier.startsWith("#/")) continue;
      const base = (specifier.startsWith("#/") ? `${WEB}${specifier.slice(2)}` : relative(ROOT, resolve(ROOT, dirname(file), specifier)))
        .replaceAll("\\", "/").replace(/\.[cm]?[jt]sx?$/, "");
      const next = [".ts", ".tsx", "/index.ts"].map((ext) => base + ext).find((path) => read(path) !== null);
      if (next) todo.push(next);
    }
  }
  return [...seen];
}

const disk = (path: string) => (existsSync(resolve(ROOT, path)) ? readFileSync(resolve(ROOT, path), "utf8") : null);

test("the Pod surface reaches no shell module at runtime", () => {
  const closure = runtimeClosure(SURFACE, disk);
  expect(closure.length, "the walk read the surface").toBeGreaterThanOrEqual(8);
  expect(closure.filter((file) => file.startsWith(`${WEB}shell/`))).toEqual([]);
});

test("a runtime shell import is red; a type-only one is not", () => {
  const files: Record<string, string> = {
    [SURFACE]: 'export * from "./a.ts";\nimport type { T } from "../shell/types.ts";',
    [`${WEB}route/a.ts`]: 'export { freezePage } from "#/shell/freeze-page";',
    [`${WEB}shell/freeze-page.ts`]: "export const freezePage = 1;",
    [`${WEB}shell/types.ts`]: "export type T = 1;",
  };
  const closure = runtimeClosure(SURFACE, (path) => files[path] ?? null);
  expect(closure.filter((file) => file.startsWith(`${WEB}shell/`))).toEqual([`${WEB}shell/freeze-page.ts`]);
});
