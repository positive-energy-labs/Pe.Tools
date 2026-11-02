import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import ts from "typescript";
import { expect, test } from "vite-plus/test";
import { root, syntax, walk } from "./unification-2-census.ts";

function keyBranches(text: string) {
  const source = syntax(text);
  const found: string[] = [];
  const catalogKey = (node: ts.Node) =>
    ts.isStringLiteral(node) && /^[a-z][a-z0-9-]*(?:\.[a-z0-9-]+)+$/.test(node.text);
  walk(source, (node) => {
    if (
      (ts.isBinaryExpression(node) &&
        [
          ts.SyntaxKind.EqualsEqualsToken,
          ts.SyntaxKind.EqualsEqualsEqualsToken,
          ts.SyntaxKind.ExclamationEqualsToken,
          ts.SyntaxKind.ExclamationEqualsEqualsToken,
        ].includes(node.operatorToken.kind) &&
        (catalogKey(node.left) || catalogKey(node.right))) ||
      (ts.isCaseClause(node) && catalogKey(node.expression))
    )
      found.push(node.getText(source));
  });
  return found;
}

test("call transport reads entry declarations, never branches on catalog keys", () => {
  expect(
    keyBranches(readFileSync(resolve(root, "ts/apps/host/src/call-route.ts"), "utf8")),
  ).toEqual([]);
});
test("the guard catches either comparison direction and switch cases, but permits entry declarations", () => {
  expect(
    keyBranches(
      `if (key === "ducts.snapshot.walk") go(); if ("host.status" !== key) stop(); switch (key) { case "pod.list": break; }`,
    ),
  ).toHaveLength(3);
  expect(
    keyBranches(`const entries = { "host.status": { hostOnly: true } }; if (entry.hostOnly) go();`),
  ).toEqual([]);
});
