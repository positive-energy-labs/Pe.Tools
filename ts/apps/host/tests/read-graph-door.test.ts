import { readFileSync } from "node:fs";
import ts from "typescript";
import { expect, test } from "vite-plus/test";

// A Pod bundles only what it imports; the evaluator drags effect in through the agent-contracts
// barrel, so the Pod's read door has its own effect-free module (the subject-ref door's rule).
test("the Pod read door imports only zod and effect-free subpaths", () => {
  const door = new URL(import.meta.resolve("@pe/host-internal/read-graph"));
  const source = ts.createSourceFile("door.ts", readFileSync(door, "utf8"), ts.ScriptTarget.Latest);
  const imports = source.statements.flatMap((statement) => {
    if (ts.isImportDeclaration(statement) && ts.isStringLiteral(statement.moduleSpecifier))
      return [(statement.importClause?.isTypeOnly ? "type " : "") + statement.moduleSpecifier.text];
    if (
      ts.isExportDeclaration(statement) &&
      statement.moduleSpecifier &&
      ts.isStringLiteral(statement.moduleSpecifier)
    )
      return [(statement.isTypeOnly ? "type " : "") + statement.moduleSpecifier.text];
    return [];
  });
  expect(imports).toEqual([
    "zod",
    "@pe/agent-contracts/target",
    "@pe/agent-contracts/route-state",
    "@pe/agent-contracts/tiered-setting", // Imports only zod, already admitted by this door.
    "@pe/agent-contracts/native-output-read",
    "@pe/host-contracts/catalog",
    "type @pe/agent-contracts/handle", // Types only: the mints import the command table, the door does not.
    "type @pe/host-contracts/operation-types",
    "type ./evaluator.ts",
    "type ./evaluator.ts",
    "type @pe/agent-contracts/handle",
  ]);
  expect(door.href).toBe(
    new URL("../../../packages/host-internal/src/reads/door.ts", import.meta.url).href,
  );
});
