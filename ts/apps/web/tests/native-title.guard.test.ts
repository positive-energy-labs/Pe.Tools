import { readFileSync, readdirSync } from "node:fs";
import { resolve, relative } from "node:path";
import ts from "typescript";
import { expect, test } from "vite-plus/test";
import baseline from "./native-title.baseline.json";

// Keyed by file + element + exact title expression, not a global count: removing one
// old hint cannot buy a new native tooltip elsewhere. Line moves do not cost slots.
function titles(source: string, file: string): string[] {
  const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const found: string[] = [];
  function visit(node: ts.Node) {
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      const tag = node.tagName.getText(ast);
      if (/^[a-z]/.test(tag)) {
        for (const attr of node.attributes.properties) {
          if (ts.isJsxAttribute(attr) && attr.name.getText(ast) === "title") {
            found.push(
              `${file}|${tag}|${attr.initializer?.getText(ast).replace(/\s+/g, " ") ?? ""}`,
            );
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(ast);
  return found;
}

test("native title allowlist can only shrink; new hints use the kit", () => {
  const root = resolve(import.meta.dirname, "../src");
  const actual: Record<string, number> = {};
  for (const path of readdirSync(root, { recursive: true, encoding: "utf8" })) {
    if (!/\.[jt]sx$/.test(path) || /\.(test|spec)\./.test(path)) continue;
    const file = relative(root, resolve(root, path)).replaceAll("\\", "/");
    for (const key of titles(readFileSync(resolve(root, path), "utf8"), file))
      actual[key] = (actual[key] ?? 0) + 1;
  }
  for (const [key, count] of Object.entries(actual)) {
    expect(count, `New native title: ${key}`).toBeLessThanOrEqual(
      baseline[key as keyof typeof baseline] ?? 0,
    );
  }
  // A removal requires pruning its allowance in the same change, so it cannot be reused later.
  expect(actual, "Prune removed native titles from the baseline; never add allowances.").toEqual(
    baseline,
  );
});

test("the guard distinguishes native hints from component titles and catches multiline JSX", () => {
  expect(
    titles('<><div\n title={name}/><Code title="Heading"/><button title="Help"/></>', "sample.tsx"),
  ).toEqual(["sample.tsx|div|{name}", 'sample.tsx|button|"Help"']);
});
