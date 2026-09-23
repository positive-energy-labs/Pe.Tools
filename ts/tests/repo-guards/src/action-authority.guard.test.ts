import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test } from "vite-plus/test";
import ts from "typescript";
import { hostOpKeys } from "../../../packages/host-contracts/src/generated/host-ops.generated.ts";
import { tsOnlyOperationCatalog } from "../../../packages/host-contracts/src/operation-types.ts";

const src = resolve(import.meta.dirname, "../../../packages/mcps/src");

test("Pea has one capability admission door", () => {
  const owners = readdirSync(src, { recursive: true })
    .filter((path) => String(path).endsWith(".ts"))
    .flatMap((path) =>
      [
        ...readFileSync(resolve(src, String(path)), "utf8").matchAll(/function runCapability\b/g),
      ].map(() => String(path).replaceAll("\\", "/")),
    );
  expect(owners).toEqual(["shared/admission.ts"]);
});

test("every catalog operation has a renderer or an explicit raw receipt decision", () => {
  const path = resolve(src, "../../../apps/web/src/ops/renderers.ts");
  const source = ts.createSourceFile(
    path,
    readFileSync(path, "utf8"),
    ts.ScriptTarget.Latest,
    true,
  );
  const keys = (name: string) => {
    const declaration = source.statements
      .filter(ts.isVariableStatement)
      .flatMap((statement) => statement.declarationList.declarations)
      .find((declaration) => declaration.name.getText(source) === name)?.initializer;
    return declaration
      ? [...declaration.getText(source).matchAll(/"([\w.-]+)"/g)].map((match) => match[1])
      : [];
  };
  const rendered = keys("outputRenderers"),
    raw = keys("rawByDesign");
  const catalog = [...hostOpKeys, ...tsOnlyOperationCatalog.map((row) => row.key)];
  expect(catalog.filter((key) => !rendered.includes(key) && !raw.includes(key))).toEqual([]);
  expect(raw.filter((key) => !catalog.includes(key as never) || rendered.includes(key))).toEqual(
    [],
  );
});
