import { readFileSync } from "node:fs";
import { resolve, relative } from "node:path";
import ts from "typescript";
import { expect, test } from "vite-plus/test";
import { root, syntax, walk } from "./unification-2-census.ts";
import { globSync } from "node:fs";

function violations(text: string) {
  const source = syntax(text),
    found: string[] = [];
  const definitions = new Map<string, ts.Expression>();
  walk(source, (node) => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer)
      definitions.set(node.name.text, node.initializer);
  });
  const inspect = (node: ts.Node, seen = new Set<string>()) => {
    walk(node, (child) => {
      if (
        ts.isCallExpression(child) &&
        /^z\.(object|strictObject|looseObject)$/.test(child.expression.getText(source))
      )
        found.push(child.getText(source));
      if (ts.isIdentifier(child) && definitions.has(child.text) && !seen.has(child.text)) {
        seen.add(child.text);
        inspect(definitions.get(child.text)!, seen);
      }
    });
  };
  walk(source, (node) => {
    if (ts.isIdentifier(node) && ["requestJson", "jsonSource"].includes(node.text))
      found.push(node.text);
    if (ts.isPropertyAssignment(node) && ["decode", "schema"].includes(node.name.getText(source))) {
      inspect(node.initializer);
    }
  });
  return found;
}
test("web callers cannot use raw JSON transport or hand response objects", () => {
  const source = resolve(root, "ts/apps/web/src");
  const found = globSync("**/*.{ts,tsx}", { cwd: source })
    .filter(
      (file) =>
        !/\.(test|fixture)\./.test(file) && file.replaceAll("\\", "/") !== "shell/readings-api.ts",
    )
    .flatMap((file) =>
      violations(readFileSync(resolve(source, file), "utf8")).map((v) => `${file}: ${v}`),
    );
  expect(found).toEqual([]);
  expect(readFileSync(resolve(source, "shell/readings-api.ts"), "utf8")).not.toMatch(
    /export (?:async )?function requestJson/,
  );
});
test("the guard rejects both raw transport and inline response decoders", () => {
  expect(
    violations(
      "requestJson(req, z.unknown(), signal); const shape = z.object({ n: z.number() }); const source = { decode: v => shape.parse(v) };",
    ),
  ).toHaveLength(2);
});
test("shared family progress is a leaf and contracts never import ducts-domain", () => {
  const source = resolve(root, "ts/packages/agent-contracts/src");
  expect(readFileSync(resolve(source, "families-progress.ts"), "utf8")).not.toMatch(/from ["']\./);
  const found = globSync("**/*.ts", { cwd: source }).flatMap((file) => {
    const text = readFileSync(resolve(source, file), "utf8");
    return /(?:from\s*|import\s*\()["']@pe\/ducts-domain/.test(text)
      ? [relative(root, resolve(source, file))]
      : [];
  });
  expect(found).toEqual([]);
});
