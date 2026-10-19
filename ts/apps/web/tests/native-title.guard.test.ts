import { readFileSync, readdirSync } from "node:fs";
import { resolve, relative } from "node:path";
import ts from "typescript";
import { expect, test } from "vite-plus/test";
import baseline from "./native-title.baseline.json";

// Hints always use kit Tooltip. iframe title is the embedded document's accessible name,
// not a hover hint; component title props remain headings or kit-owned hint contracts.
function titles(source: string, file: string): string[] {
  const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const found: string[] = [];
  const objects = new Map<string, ts.Expression>();
  function collect(node: ts.Node) {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer)
      objects.set(node.name.text, node.initializer);
    ts.forEachChild(node, collect);
  }
  collect(ast);
  function spreadTitles(expression: ts.Expression, seen = new Set<string>()): string[] {
    if (ts.isIdentifier(expression)) {
      if (seen.has(expression.text)) return [];
      seen.add(expression.text);
      const value = objects.get(expression.text);
      return value ? spreadTitles(value, seen) : [];
    }
    if (!ts.isObjectLiteralExpression(expression)) return [];
    return expression.properties.flatMap((property) => {
      if (ts.isSpreadAssignment(property)) return spreadTitles(property.expression, seen);
      if (
        ts.isPropertyAssignment(property) &&
        property.name.getText(ast).replace(/["']/g, "") === "title"
      )
        return [property.initializer.getText(ast).replace(/\s+/g, " ")];
      return [];
    });
  }
  function visit(node: ts.Node) {
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      const tag = node.tagName.getText(ast);
      const forwardsNative =
        [
          "Input",
          "InputPrimitive",
          "Verdict",
          "Link",
          "Textarea",
          "Label",
          "DialogHeader",
          "TooltipTrigger",
          "PopoverTrigger",
        ].includes(tag) || /\.Trigger$/.test(tag);
      if ((/^[a-z]/.test(tag) && tag !== "iframe") || forwardsNative) {
        for (const attr of node.attributes.properties) {
          if (ts.isJsxSpreadAttribute(attr))
            for (const title of spreadTitles(attr.expression))
              found.push(`${file}|${tag}|spread:${title}`);
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

test("native title hints are zero across web and kit; hints use kit Tooltip", () => {
  const actual: Record<string, number> = {};
  for (const root of [
    resolve(import.meta.dirname, "../src"),
    resolve(import.meta.dirname, "../../../packages/kit/src"),
  ]) {
    for (const path of readdirSync(root, { recursive: true, encoding: "utf8" })) {
      if (!/\.[jt]sx$/.test(path) || /\.(test|spec)\./.test(path)) continue;
      const file = relative(root, resolve(root, path)).replaceAll("\\", "/");
      for (const key of titles(readFileSync(resolve(root, path), "utf8"), file))
        actual[key] = (actual[key] ?? 0) + 1;
    }
  }
  expect(baseline, "Native hint allowances must stay empty.").toEqual({});
  expect(actual, "Native hints must use kit Tooltip; never add allowances.").toEqual({});
});

test("native-forwarding controls and links cannot carry title hints", () => {
  expect(
    titles(
      '<><Input title="Input hint"/><Verdict title={reason}/><Link title="Link hint"/><Pane title="Heading"/><FactChip title="Kit hint"/></>',
      "sample.tsx",
    ),
  ).toEqual([
    'sample.tsx|Input|"Input hint"',
    "sample.tsx|Verdict|{reason}",
    'sample.tsx|Link|"Link hint"',
  ]);
});

test("the guard catches native title hints forwarded through local object spreads", () => {
  expect(
    titles(
      'const shared = {title: name}; const view = <><div {...shared}/><span {...{title: "Hint"}}/></>;',
      "sample.tsx",
    ),
  ).toEqual(["sample.tsx|div|spread:name", 'sample.tsx|span|spread:"Hint"']);
});

test("the guard distinguishes native hints from component titles and catches multiline JSX", () => {
  expect(
    titles(
      '<><div\n title={name}/><Code title="Heading"/><button title="Help"/><iframe title="Document"/></>',
      "sample.tsx",
    ),
  ).toEqual(["sample.tsx|div|{name}", 'sample.tsx|button|"Help"']);
});
