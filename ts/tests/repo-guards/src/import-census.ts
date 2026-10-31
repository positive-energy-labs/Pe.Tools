import { readdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import ts from "typescript";

export const ROOT = resolve(import.meta.dirname, "../../..");
export const WEB = "apps/web/src/";

// Match kit-census's production boundary; tests and disposable specimens are not consumers.
export function productionFiles(root: string): string[] {
  return readdirSync(resolve(ROOT, root), { recursive: true, encoding: "utf8" })
    .map((path) => `${root}/${path.replaceAll("\\", "/")}`)
    .filter(
      (path) =>
        /\.[cm]?[jt]sx?$/.test(path) &&
        !/\.(?:test|spec)\./.test(path) &&
        !/\/(?:node_modules|dist|dist-installed|__tests__|prototypes|lab|design-system)\//.test(
          path,
        ) &&
        !path.startsWith(WEB + "routes/design-system"),
    );
}

export type Import = { module: string; names: string[] | null };

// Names are the imported names, before aliases. Null means the entire module is reachable.
export function imports(source: string, path: string): Import[] {
  const ast = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true);
  const found: Import[] = [];
  function visit(node: ts.Node) {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      const clause = node.importClause;
      const bindings = clause?.namedBindings;
      const names =
        clause && !clause.name && bindings && ts.isNamedImports(bindings)
          ? bindings.elements.map((item) => (item.propertyName ?? item.name).text)
          : null;
      found.push({ module: node.moduleSpecifier.text, names });
    } else if (
      ts.isExportDeclaration(node) &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      const names =
        node.exportClause && ts.isNamedExports(node.exportClause)
          ? node.exportClause.elements.map((item) => (item.propertyName ?? item.name).text)
          : null;
      found.push({ module: node.moduleSpecifier.text, names });
    } else if (
      ts.isCallExpression(node) &&
      (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
        (ts.isIdentifier(node.expression) && node.expression.text === "require")) &&
      node.arguments[0] &&
      ts.isStringLiteral(node.arguments[0])
    ) {
      found.push({ module: node.arguments[0].text, names: null });
    }
    ts.forEachChild(node, visit);
  }
  visit(ast);
  return found;
}

export function modulePath(file: string, specifier: string): string {
  const path = specifier.startsWith("#/")
    ? resolve(ROOT, WEB, specifier.slice(2))
    : specifier.startsWith(".")
      ? resolve(ROOT, dirname(file), specifier)
      : specifier;
  return path.replaceAll("\\", "/").replace(/\.[cm]?[jt]sx?$/, "");
}

export const readImports = (file: string): Import[] =>
  imports(readFileSync(resolve(ROOT, file), "utf8"), file);

export function ratchet(actual: string[], baseline: Record<string, number>) {
  return {
    violations: actual.filter((file) => baseline[file] !== 1),
    stale: Object.keys(baseline).filter((file) => !actual.includes(file)),
  };
}
