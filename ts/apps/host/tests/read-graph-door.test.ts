import { readFileSync } from "node:fs";
import ts from "typescript";
import { expect, test } from "vite-plus/test";

// A Pod bundles only what it imports; the evaluator drags effect in through the agent-contracts
// barrel, so the Pod's read door has its own effect-free module (the subject-ref door's rule).
test("the Pod read door imports only zod and effect-free subpaths", () => {
  const door = new URL(import.meta.resolve("@pe/host-internal/read-graph"));
  const source = ts.createSourceFile("door.ts", readFileSync(door, "utf8"), ts.ScriptTarget.Latest);
  const imports = source.statements.flatMap((statement) => {
    if (
      ts.isImportDeclaration(statement) &&
      !statement.importClause?.isTypeOnly &&
      ts.isStringLiteral(statement.moduleSpecifier)
    )
      return [statement.moduleSpecifier.text];
    if (
      ts.isExportDeclaration(statement) &&
      !statement.isTypeOnly &&
      statement.moduleSpecifier &&
      ts.isStringLiteral(statement.moduleSpecifier)
    )
      return [statement.moduleSpecifier.text];
    return [];
  });
  expect(imports).toEqual([
    "zod",
    "@pe/agent-contracts/target",
    "@pe/agent-contracts/tiered-setting", // Imports only zod, already admitted by this door.
    "@pe/agent-contracts/native-output-read",
    "@pe/host-contracts/catalog",
  ]);
  expect(door.href).toBe(
    new URL("../../../packages/host-internal/src/reads/door.ts", import.meta.url).href,
  );
});
