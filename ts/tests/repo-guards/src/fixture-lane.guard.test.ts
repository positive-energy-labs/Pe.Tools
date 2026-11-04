import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import ts from "typescript";
import { expect, test } from "vite-plus/test";
import { ROOT, productionFiles } from "./import-census.js";

test("S1: fixture transports never branch on operation keys or seed routes", () => {
  const paths = [
    ...productionFiles("apps/web/src").filter((path) => /fixture[^/]*\.[jt]sx?$/.test(path)),
    "apps/host/src/demo-owner.ts",
    "packages/host-contracts/src/fixture-host.ts",
  ];
  const violations: string[] = [];
  for (const path of paths) {
    expect(path.endsWith("/host.fixture.ts"), path).toBe(false);
    const ast = ts.createSourceFile(
      path,
      readFileSync(resolve(ROOT, path), "utf8"),
      ts.ScriptTarget.Latest,
      true,
    );
    const visit = (node: ts.Node) => {
      const dispatchKey = (value: ts.Node) =>
        /(?:^|\.)(?:key|opKey|operationKey|op)$/.test(value.getText(ast));
      const forbidden = (value: ts.Node) => {
        if (!ts.isStringLiteralLike(value)) return false;
        // Operation identities have dotted namespaces; route dispatch is prohibited separately.
        return /^[\w-]+\.[\w.-]+$/.test(value.text);
      };
      if (
        (ts.isBinaryExpression(node) &&
          [
            ts.SyntaxKind.EqualsEqualsEqualsToken,
            ts.SyntaxKind.EqualsEqualsToken,
            ts.SyntaxKind.ExclamationEqualsToken,
            ts.SyntaxKind.ExclamationEqualsEqualsToken,
          ].includes(node.operatorToken.kind) &&
          (forbidden(node.left) ||
            forbidden(node.right) ||
            (dispatchKey(node.left) && ts.isStringLiteralLike(node.right)) ||
            (dispatchKey(node.right) && ts.isStringLiteralLike(node.left)) ||
            /\bseed\.route\b/.test(node.getText(ast)))) ||
        (ts.isCaseClause(node) &&
          (forbidden(node.expression) ||
            (ts.isSwitchStatement(node.parent.parent) &&
              dispatchKey(node.parent.parent.expression))))
      )
        violations.push(`${path}:${ast.getLineAndCharacterOfPosition(node.getStart()).line + 1}`);
      ts.forEachChild(node, visit);
    };
    visit(ast);
  }
  expect(violations).toEqual([]);
});

test("D2: graph modules never eagerly import fixture payloads", () => {
  const violations: string[] = [];
  for (const path of productionFiles("apps/web/src").filter((path) => path.endsWith("/graph.ts"))) {
    const ast = ts.createSourceFile(
      path,
      readFileSync(resolve(ROOT, path), "utf8"),
      ts.ScriptTarget.Latest,
      true,
    );
    for (const node of ast.statements) {
      const specifier =
        (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier;
      if (specifier && ts.isStringLiteral(specifier) && /fixture|seeds|[?]raw/.test(specifier.text))
        violations.push(
          `${path}:${ast.getLineAndCharacterOfPosition(node.getStart()).line + 1}: ${specifier.text}`,
        );
    }
  }
  expect(violations).toEqual([]);
});
