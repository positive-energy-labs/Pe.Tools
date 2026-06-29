import { expect, test } from "vite-plus/test";
import {
  buildDefaultValuesFromSchema,
  type RenderSchemaNode,
  SchemaDocument,
} from "../src/index.ts";

const THEN_KEYWORD = ("th" + "en") as "then";

// The schema engine is the one fragile, regression-prone boundary in the port:
// $ref resolution, allOf merging, and default synthesis. One graph-level test
// exercises all three through the public SchemaDocument API.
const schema: RenderSchemaNode = {
  type: "object",
  $defs: {
    Size: { type: "string", enum: ["s", "m", "l"], default: "m" },
  },
  properties: {
    name: { type: "string", default: "untitled" },
    size: { $ref: "#/$defs/Size" },
    box: {
      allOf: [
        { type: "object", properties: { w: { type: "number", default: 1 } } },
        { type: "object", properties: { h: { type: "number", default: 2 } } },
      ],
    },
  },
};

const supportedSubsetSchema: RenderSchemaNode = {
  type: "object",
  properties: {
    mode: {
      type: "string",
      enum: ["simple", "advanced"],
      examples: ["simple"],
      default: "simple",
    },
    dynamicValues: {
      type: "object",
      additionalProperties: { type: "string" },
    },
    conditional: {
      type: "object",
      properties: {
        kind: { type: "string", enum: ["a", "b"] },
      },
      if: { properties: { kind: { const: "a" } } },
      [THEN_KEYWORD]: {
        properties: { aOnly: { type: "string", default: "A" } },
        required: ["aOnly"],
      },
      else: {
        properties: { bOnly: { type: "integer", default: 2 } },
        required: ["bOnly"],
      },
    },
    tableRows: {
      type: "array",
      items: {
        type: "object",
        properties: { name: { type: "string" } },
        additionalProperties: { type: "string" },
        "x-ui": {
          renderer: "table",
          behavior: {
            fixedColumns: ["name"],
            dynamicColumnsFromAdditionalProperties: true,
            dynamicColumnOrder: { source: "familyParameterNames", values: ["A", "B"] },
          },
        },
      },
    },
  },
};

test("$ref resolves to the referenced node", () => {
  const size = SchemaDocument.from(schema).at("size").effective();
  expect(size.kind()).toBe("string");
  expect(size.isEnumLike()).toBe(true);
});

test("allOf merges sibling property sets", () => {
  const box = SchemaDocument.from(schema).at("box").effective();
  expect(box.kind()).toBe("object");
  expect(
    box
      .sortedProperties()
      .map(([key]) => key)
      .sort(),
  ).toEqual(["h", "w"]);
});

test("defaults synthesize from explicit defaults and merged composition", () => {
  const doc = SchemaDocument.from(schema);
  const rootDefaults = buildDefaultValuesFromSchema(doc.rawRoot(), schema) as Record<
    string,
    unknown
  >;
  expect(rootDefaults.name).toBe("untitled");

  const boxDefaults = buildDefaultValuesFromSchema(doc.at("box").effective().raw(), schema);
  expect(boxDefaults).toEqual({ w: 1, h: 2 });
});

test("supported subset covers conditionals, enum examples, maps, and dynamic table columns", () => {
  const doc = SchemaDocument.from(supportedSubsetSchema);

  const mode = doc.at("mode");
  expect(mode.isEnumLike()).toBe(true);
  expect(mode.hasInlineSuggestions()).toBe(true);
  expect(mode.defaultValue()).toBe("simple");

  const dynamicValue = doc.at("dynamicValues.anyKey");
  expect(dynamicValue.kind()).toBe("string");

  const aBranch = doc.at("conditional").effective({ kind: "a" });
  expect(aBranch.raw().required).toContain("aOnly");
  expect(aBranch.defaultValue()).toMatchObject({ aOnly: "A" });

  const bBranch = doc.at("conditional").effective({ kind: "b" });
  expect(bBranch.raw().required).toContain("bOnly");
  expect(bBranch.defaultValue()).toMatchObject({ bOnly: 2 });

  const tableItem = doc.at("tableRows.0");
  expect(tableItem.uiMetadata()?.behavior?.dynamicColumnsFromAdditionalProperties).toBe(true);
  expect(tableItem.uiMetadata()?.behavior?.dynamicColumnOrder?.values).toEqual(["A", "B"]);
});
