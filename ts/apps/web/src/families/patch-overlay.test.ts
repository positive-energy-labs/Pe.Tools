import { familiesPatchCellSchema, familyCellKey } from "@pe/agent-contracts";
import { expect, test } from "vite-plus/test";

import type { TypeRow } from "./matrix-columns";
import { projectPatch, readParameterValue } from "./patch-overlay";

const params = [
  { key: "a", name: "Width" },
  { key: "b", name: "Width" },
  { key: "m", name: "Model" },
];
const type = (familyName: string, typeName: string, model: string): TypeRow => ({
  key: `${familyName}/${typeName}`,
  familyId: 1,
  familyName,
  categoryName: "Mechanical Equipment",
  typeName,
  typeCount: 2,
  values: { m: model },
  scopes: { m: "Family" },
  formulas: {},
  storageTypes: { m: "String" },
});
const rows = [type("FCU", "FCU-1", "FXMQ15"), type("FCU", "FCU-2", " "), type("AHU", "AHU-1", "X")];
const source = (body: object) => ({
  path: "patches/demo.json",
  content: JSON.stringify({
    $schema: "http://localhost:5150/schemas/settings/FamilyFoundry/patches.json",
    ...body,
  }),
});
const at = (typeName: string, parameter: string) =>
  familyCellKey({ familyName: "FCU", typeName, parameter });

test("the scoped lookup resolves within the actual type and refuses ambiguity", () => {
  expect(
    readParameterValue(
      { scopes: { a: "Family", b: "Unresolved" }, values: { a: "0", b: "9" } },
      "Width",
      params,
    ),
  ).toBe("0");
  expect(
    readParameterValue({ scopes: { a: "Family", b: "Family" }, values: {} }, "Width", params),
  ).toBe("ambiguous");
  expect(readParameterValue({ scopes: {}, values: { a: "9" } }, "Width", params)).toBe("∅");
  expect(readParameterValue({ scopes: { a: "Family" }, values: { a: " " } }, "Width", params)).toBe(
    "blank",
  );
});

test("each rung projects separately; a direct alias reads its source per type; types beat uniform", () => {
  const patch = familiesPatchCellSchema.parse({
    staged: {
      value: source({
        select: { names: ["FCU"] },
        patch: { parameters: { Code: { formula: "Model", tooltip: "the model code" } } },
      }),
    },
    proposal: {
      value: source({
        select: { names: ["FCU"], categories: ["Mechanical Equipment"] },
        patch: {
          parameters: { Model: { value: "Z" }, Code: { formula: "Model" } },
          types: { "FCU-2": { Model: "FXMQ24" } },
        },
        run: { parametersIfSourceExists: ["Model"] },
      }),
    },
  });
  const overlay = projectPatch(patch, rows, params);
  expect(overlay.cells[at("FCU-1", "Code")]).toEqual({
    staged: { value: "≈ FXMQ15", how: "alias" },
    proposal: { value: "≈ FXMQ15", how: "alias" },
  });
  expect(overlay.cells[at("FCU-2", "Code")]?.staged).toEqual({ value: "unresolved", how: "alias" });
  expect(overlay.cells[at("FCU-1", "Model")]).toEqual({ proposal: { value: "Z", how: "uniform" } });
  expect(overlay.cells[at("FCU-2", "Model")]).toEqual({
    proposal: { value: "FXMQ24", how: "type" },
  });
  expect(Object.keys(overlay.cells).some((key) => key.includes("AHU"))).toBe(false);
  expect(overlay.parameters.Code).toMatchObject({
    families: ["FCU"],
    absent: true,
    staged: { formula: "Model", tooltip: "the model code" },
  });
  expect(overlay.parameters.Model?.absent).toBe(false);
  expect(overlay.unprojected).toEqual([
    "proposal: select.categories is not projected",
    "proposal: run.parametersIfSourceExists creates conditionally; drawn as if every source exists",
  ]);
});

test("an array of parameters or a names-less select is said, never silently dropped", () => {
  const patch = familiesPatchCellSchema.parse({
    proposal: {
      value: source({
        select: { categoryNames: ["Mechanical Equipment"] },
        patch: { parameters: [{ name: "Code", mapFrom: "Model" }] },
      }),
    },
  });
  const overlay = projectPatch(patch, rows, params);
  expect(overlay.cells).toEqual({});
  expect(overlay.unprojected).toEqual([
    "proposal: select.categoryNames is not projected",
    "proposal: select names no family, so no cell is projected",
    "proposal: patch.parameters is an array; Family Foundry keys parameters by name",
  ]);
});
