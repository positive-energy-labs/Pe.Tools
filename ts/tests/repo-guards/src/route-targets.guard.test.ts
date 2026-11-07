import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import ts from "typescript";
import { expect, test } from "vite-plus/test";
import { ROUTE_DIRECTORY } from "../../../packages/agent-contracts/src/route-directory.ts";
import { files, root, syntax, walk } from "./unification-2-census.ts";

test("literal web navigation targets have a registered first path segment", () => {
  const sources = files("ts/apps/web/src")
    .filter((file) => /\.[cm]?tsx?$/.test(file) && !/(?:\.(?:test|spec)\.|\/tests?\/)/.test(file))
    .map((file) => syntax(readFileSync(resolve(root, file), "utf8"), file));
  const segment = (path: string) => path.split(/[/?#]/)[1] ?? "";
  const registered = new Set(["", ...ROUTE_DIRECTORY.flatMap((route) =>
    [route.path, ...(route.satellites ?? []).map((entry) => entry.to)].map(segment))]);
  const literal = (node: ts.Node | undefined): string | undefined =>
    node && ts.isStringLiteralLike(node) ? node.text : undefined;
  // File routes and codeRoutes' routeFromGraph registrations supplement the generated directory.
  for (const source of sources) walk(source, (node) => {
    if (!ts.isCallExpression(node)) return;
    const name = node.expression.getText();
    const path = name === "createFileRoute" ? literal(node.arguments[0])
      : name === "routeFromGraph" ? literal(node.arguments[2]) : undefined;
    if (path?.startsWith("/")) registered.add(segment(path));
  });
  const dead: string[] = [];
  for (const source of sources) {
    const check = (node: ts.Node | undefined) => {
      const target = literal(node);
      if (!target?.startsWith("/") || target.startsWith("//") || registered.has(segment(target))) return;
      // Public files (for example the PWA manifest) are resources, not navigation routes.
      if (existsSync(resolve(root, "ts/apps/web/public", target.slice(1).split(/[?#]/)[0]!))) return;
      const line = source.getLineAndCharacterOfPosition(node!.getStart()).line + 1;
      dead.push(`${source.fileName}:${line} ${target}`);
    };
    walk(source, (node) => {
      if (ts.isPropertyAssignment(node) && node.name.getText().replaceAll(/["']/g, "") === "href")
        check(node.initializer);
      if (ts.isJsxAttribute(node) && node.name.getText() === "href") {
        check(node.initializer && ts.isJsxExpression(node.initializer)
          ? node.initializer.expression : node.initializer);
      }
      if (!ts.isCallExpression(node)) return;
      const name = node.expression.getText().split(".").at(-1);
      if (name === "go") check(node.arguments[0]);
      if (name === "navigate" && node.arguments[0] && ts.isObjectLiteralExpression(node.arguments[0])) {
        for (const prop of node.arguments[0].properties)
          if (ts.isPropertyAssignment(prop) && prop.name.getText().replaceAll(/["']/g, "") === "to")
            check(prop.initializer);
      }
    });
  }
  expect(dead, "Use a registered route address; remove doors when retiring routes").toEqual([]);
}, 15_000);
