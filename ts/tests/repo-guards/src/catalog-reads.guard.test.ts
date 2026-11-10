import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import ts from "typescript";
import { expect, test } from "vite-plus/test";
import { imports } from "./import-census.ts";
import { root, syntax, walk } from "./unification-2-census.ts";
import { globSync } from "node:fs";

// Only raw transport is a live violation: no source factory takes a response decoder any more
// (subscriptionSource and its siblings were deleted with the legacy shell kernel).
function violations(text: string) {
  const found: string[] = [];
  walk(syntax(text), (node) => {
    if (ts.isIdentifier(node) && ["requestJson", "jsonSource"].includes(node.text))
      found.push(node.text);
  });
  return found;
}
test("web callers cannot use raw JSON transport or hand response objects", () => {
  const source = resolve(root, "ts/apps/web/src");
  const found = globSync("**/*.{ts,tsx}", { cwd: source })
    .filter(
      (file) =>
        !/\.(test|fixture)\./.test(file) && file.replaceAll("\\", "/") !== "host/catalog-client.ts",
    )
    .flatMap((file) =>
      violations(readFileSync(resolve(source, file), "utf8")).map((v) => `${file}: ${v}`),
    );
  expect(found).toEqual([]);
  expect(readFileSync(resolve(source, "host/catalog-client.ts"), "utf8")).not.toMatch(
    /export (?:async )?function requestJson/,
  );
});
test("the guard rejects raw transport", () => {
  expect(violations("requestJson(req, z.unknown(), signal);")).toEqual(["requestJson"]);
});
test("shared family progress is a leaf and contracts never import ducts-domain", () => {
  const source = resolve(root, "ts/packages/agent-contracts/src");
  const modules = (file: string) =>
    imports(readFileSync(resolve(source, file), "utf8"), file, true).map(({ module }) => module);
  expect(modules("families-progress.ts").filter((module) => module.startsWith("."))).toEqual([]);
  const found = globSync("**/*.ts", { cwd: source }).filter((file) =>
    modules(file).some((module) => module.startsWith("@pe/ducts-domain")),
  );
  expect(found).toEqual([]);
});
