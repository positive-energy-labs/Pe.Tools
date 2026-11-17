import { readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import ts from "typescript";
import { expect, test } from "vite-plus/test";
import { productWebDirectories, routeModules } from "./product-source-roots.ts";
import { ROOT, productionFiles } from "./import-census.js";

test("S1: fixture transports never branch on operation keys or seed routes", () => {
  const paths = [
    ...productionFiles("apps/web/src").filter((path) => /fixture[^/]*\.[jt]sx?$/.test(path)),
    ...productWebDirectories().flatMap(dir => productionFiles(relative(ROOT, join(dir, "src")).replaceAll("\\", "/")))
      .filter(path => /fixture[^/]*\.[jt]sx?$/.test(path)),
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

// Frozen: the one route module that still imports a fixture payload eagerly. Slice 6 (one read
// constructor) removes `hostRead(reads.sheet, sheetValueFixtures)`; this list only shrinks.
const D2_FROZEN = ["products/fans/web/route.ts: ./src/calc/value-fixtures.ts"];

// Retargeted from `*/graph.ts` (none since 6ecbc716) to the route modules route-graphs.ts loads.
test("D2: route modules never eagerly import fixture payloads", () => {
  const violations: string[] = [];
  const modules = routeModules();
  expect(modules.length, "the guard reads route modules; none found").toBeGreaterThanOrEqual(15);
  for (const path of modules) {
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
        violations.push(`${path}: ${specifier.text}`);
    }
  }
  expect(violations.filter((v) => !D2_FROZEN.includes(v)), "a new eager fixture import").toEqual([]);
  expect(D2_FROZEN.filter((v) => !violations.includes(v)), "fixed: delete it from D2_FROZEN").toEqual([]);
});
