import { readdirSync, readFileSync } from "node:fs";
import { join, posix } from "node:path";
import ts from "typescript";
import { ROOT } from "./import-census.ts";

export function workspaceFiles(root: string, dir: string) {
  function visit(folder: string): string[] {
    return readdirSync(join(root, folder), { withFileTypes: true }).flatMap((entry) => {
      const file = posix.join(folder, entry.name);
      if (entry.isDirectory())
        return ["dist", "dist-installed", "node_modules"].includes(entry.name) ? [] : visit(file);
      return /\.[cm]?[jt]sx?$/.test(file) ||
        entry.name === "package.json" ||
        /^tsconfig.*\.json$/.test(entry.name)
        ? [file]
        : [];
    });
  }
  return visit(dir);
}

export function workspaceNames(root: string, dir: string) {
  return new Set(
    readdirSync(join(root, dir), { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map(
        (entry) =>
          JSON.parse(readFileSync(join(root, dir, entry.name, "package.json"), "utf8"))
            .name as string,
      ),
  );
}

/** Every literal is a possible dependency, including aliases, fixtures, mocks and module augmentation.
 * Fold fixed concatenations as well. A runtime-selected string with no static reference is not a source edge.
 */
export function workspaceReferences(file: string, source: string): string[] {
  const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  const found = new Set<string>();
  function constant(node: ts.Node): string | undefined {
    if (ts.isStringLiteralLike(node)) return node.text;
    if (ts.isParenthesizedExpression(node) || ts.isAsExpression(node))
      return constant(node.expression);
    if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken) {
      const left = constant(node.left),
        right = constant(node.right);
      if (left !== undefined && right !== undefined) return left + right;
    }
    if (ts.isTemplateExpression(node)) {
      let result = node.head.text;
      for (const span of node.templateSpans) {
        const value = constant(span.expression);
        if (value === undefined) return;
        result += value + span.literal.text;
      }
      return result;
    }
  }
  function visit(node: ts.Node) {
    const text = constant(node);
    if (text !== undefined) found.add(text);
    // The statically named package remains reachable when only its subpath is dynamic.
    if (ts.isTemplateHead(node)) found.add(node.text);
    ts.forEachChild(node, visit);
  }
  visit(ast);
  return [...found];
}

export function importsWorkspace(
  file: string,
  reference: string,
  dir: string,
  names: ReadonlySet<string>,
) {
  const specifier = reference.replaceAll("\\", "/");
  const normalized = specifier.startsWith(".")
    ? posix.join(posix.dirname(file), specifier)
    : specifier.replace(/^ts\//, "");
  if (normalized === dir || normalized.startsWith(dir + "/")) return true;
  const name = specifier
    .split("/")
    .slice(0, specifier.startsWith("@") ? 2 : 1)
    .join("/");
  return names.has(name);
}

export function productAppImports(root = ROOT) {
  const apps = workspaceNames(root, "apps");
  return workspaceFiles(root, "products")
    .flatMap((file) =>
      workspaceReferences(file, readFileSync(join(root, file), "utf8"))
        .filter((specifier) => importsWorkspace(file, specifier, "apps", apps))
        .map((specifier) => file + " -> " + specifier),
    )
    .sort();
}
