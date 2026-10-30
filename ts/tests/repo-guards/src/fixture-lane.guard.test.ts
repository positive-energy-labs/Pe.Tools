import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import ts from "typescript";
import { expect, test } from "vite-plus/test";
import { ROOT, productionFiles } from "./import-census.js";

test("D2: routes never read the retired demo URL key", () => {
  const violations: string[] = [];
  for (const path of [
    ...productionFiles("apps/web/src"),
    ...productionFiles("packages/kit/src"),
    ...productionFiles("packages/agent-contracts/src/routes"),
  ]) {
    const source = readFileSync(resolve(ROOT, path), "utf8");
    const ast = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true);
    const report = (node: ts.Node) =>
      violations.push(`${path}:${ast.getLineAndCharacterOfPosition(node.getStart()).line + 1}`);
    const visit = (node: ts.Node) => {
      if (
        ts.isPropertyAccessExpression(node) &&
        node.name.text === "demo" &&
        /(?:page|search|fields|params)$/i.test(node.expression.getText(ast))
      )
        report(node);
      if (
        ts.isElementAccessExpression(node) &&
        ts.isStringLiteral(node.argumentExpression) &&
        node.argumentExpression.text === "demo"
      )
        report(node);
      if (
        ts.isCallExpression(node) &&
        ts.isPropertyAccessExpression(node.expression) &&
        ["get", "has"].includes(node.expression.name.text) &&
        node.arguments.some((arg) => ts.isStringLiteral(arg) && arg.text === "demo")
      )
        report(node);
      if (ts.isBindingElement(node) && (node.propertyName ?? node.name).getText(ast) === "demo") {
        const declaration = node.parent.parent;
        if (
          ts.isVariableDeclaration(declaration) &&
          declaration.initializer &&
          /page|search|params/i.test(declaration.initializer.getText(ast))
        )
          report(node);
      }
      if (ts.isStringLiteralLike(node) && /[?&]demo=/.test(node.text)) report(node);
      ts.forEachChild(node, visit);
    };
    visit(ast);
  }
  expect(violations).toEqual([]);
  expect(existsSync(resolve(ROOT, "apps/web/src/host/demo-client.ts"))).toBe(false);
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
