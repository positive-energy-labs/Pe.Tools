import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import ts from "typescript";
import { expect,test } from "vite-plus/test";
import { files,root,syntax,walk } from "./unification-2-census";

/** Pane admission is lazy only if its body constructs that pane alone. */
function fakePaneSlots(source: ts.SourceFile): number[] {
  const dictionaries = new Set<string>();
  const hits = new Set<number>();
  const line = (node: ts.Node) => source.getLineAndCharacterOfPosition(node.getStart()).line + 1;
  const unparen = (node: ts.Expression): ts.Expression =>
    ts.isParenthesizedExpression(node) ? unparen(node.expression) : node;
  const isNode = (node: ts.Expression) => {
    const value = unparen(node);
    return ts.isJsxElement(value) || ts.isJsxSelfClosingElement(value) || ts.isJsxFragment(value);
  };
  walk(source, (node) => {
    if (!ts.isVariableDeclaration(node) || !ts.isIdentifier(node.name) || !node.initializer) return;
    // ActionFlag is route-level verb furniture, not a pane slot (fans-pick ruling).
    if (node.name.text === "ActionFlag") return;
    const value = unparen(node.initializer);
    if (
      ts.isCallExpression(value) &&
      value.expression.getText() === "createContext" &&
      value.typeArguments?.some(
        (type) =>
          /ReactNode/.test(type.getText()) &&
          (/Record\s*</.test(type.getText()) || /\[.*:.*string.*\]/.test(type.getText())),
      )
    )
      hits.add(line(node));
    if (
      ts.isObjectLiteralExpression(value) &&
      value.properties.length > 1 &&
      value.properties.every(
        (property) => ts.isPropertyAssignment(property) && isNode(property.initializer),
      )
    )
      dictionaries.add(node.name.text);
  });
  walk(source, (node) => {
    if (
      ts.isElementAccessExpression(node) &&
      ts.isIdentifier(node.expression) &&
      dictionaries.has(node.expression.text)
    )
      hits.add(line(node));
  });
  return [...hits].sort((a, b) => a - b);
}

test("admitted pane bodies have zero pre-rendered pane dictionaries", () => {
  const hits = files("ts/apps/web/src")
    .filter((path) => /\.tsx?$/.test(path) && !/\.(?:test|fixture)\./.test(path))
    .flatMap((path) =>
      fakePaneSlots(syntax(readFileSync(resolve(root, path), "utf8"), path)).map(
        (line) => `${path}:${line}`,
      ),
    );
  expect(hits).toEqual([]);
});

test("fake-pane law rejects context slots and computed node dictionaries", () => {
  expect(
    fakePaneSlots(syntax("const slots = createContext<Readonly<Record<string, ReactNode>>>({});")),
  ).toEqual([1]);
  expect(
    fakePaneSlots(
      syntax("const panes = { a: <A/>, b: <B/> }; function Pane({id}) { return panes[id]; }"),
    ),
  ).toEqual([1]);
  expect(fakePaneSlots(syntax("function Pane() { return <A/>; }"))).toEqual([]);
  expect(
    fakePaneSlots(
      syntax("const ActionFlag = createContext<Readonly<Record<string, ReactNode>>>({});"),
    ),
  ).toEqual([]);
});
