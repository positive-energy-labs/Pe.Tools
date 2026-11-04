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
  const factories = new Set(["subscriptionSource", "ductsBodySource", "opSource", "composeSource"]);
  walk(source, (node) => {
    if (ts.isImportSpecifier(node) && factories.has((node.propertyName ?? node.name).text))
      factories.add(node.name.text);
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
  const inspectDecoder = (node: ts.Node, seen = new Set<string>()) => {
    if (ts.isIdentifier(node) && definitions.has(node.text) && !seen.has(node.text)) {
      seen.add(node.text);
      inspectDecoder(definitions.get(node.text)!, seen);
    } else if (ts.isObjectLiteralExpression(node)) {
      for (const property of node.properties) {
        if (ts.isPropertyAssignment(property) && ["decode", "schema"].includes(property.name.getText(source)))
          inspect(property.initializer);
        else if (ts.isSpreadAssignment(property)) inspectDecoder(property.expression, seen);
      }
    }
  };
  walk(source, (node) => {
    if (ts.isIdentifier(node) && ["requestJson", "jsonSource"].includes(node.text))
      found.push(node.text);
    // A Page codec also has `decode`/`schema`. Only the transport source's decoder
    // sees hostile host responses; follow its local aliases into the actual factory input.
    if (ts.isCallExpression(node) &&
        factories.has(node.expression.getText(source))) {
      for (const arg of node.arguments) inspectDecoder(arg);
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
      "requestJson(req, z.unknown(), signal); const shape = z.object({ n: z.number() }); const source = { decode: v => shape.parse(v) }; subscriptionSource(source);",
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

test("Page codecs are local state, while aliased source decoders still reject hostile response shapes", () => {
  const shape = 'const shape = z.object({ open: z.string() });';
  expect(violations(`${shape} const page = { schema: shape, decode: v => shape.parse(v) };`)).toEqual([]);
  expect(violations(`${shape} const decoder = v => shape.parse(v); const options = { decode: decoder }; const alias = options; subscriptionSource({ ...alias });`)).toHaveLength(1);
  expect(violations(`import { subscriptionSource as read } from "./readings-use"; ${shape} read({ decode: v => shape.parse(v) });`)).toHaveLength(1);
  expect(violations('subscriptionSource({ decode: v => catalogSchema.parse(v) });')).toEqual([]);
});
