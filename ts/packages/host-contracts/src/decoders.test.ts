import { Schema } from "effect";
import { readFileSync } from "node:fs";
import { expect, test } from "vite-plus/test";
import {
  generatedJsonSchema,
  nativeResponseSchema,
  nativeRequestSchema,
  nativeResponseDefinitionSchema,
  effectDecoder,
} from "./decoders.ts";

test.each([
  "2026-11-02T08:23:20.757+00:00",
  "2026-11-02T02:23:20.757-06:00",
  "2026-11-02T08:23:20Z",
])("generated date-time accepts DateTimeOffset %s", (value) => {
  const schema = generatedJsonSchema({ type: "string", format: "date-time" });
  expect(schema.parse(value)).toBe(value);
  expect(schema.safeParse("2026-02-30T08:23:20Z").success).toBe(false);
  expect(schema.safeParse("yesterday").success).toBe(false);
});

test.each(["roster", "system-walk", "four-fan-walk"])(
  "real K2 %s round-trips through the web decoder",
  (name) => {
    const payload = JSON.parse(
      readFileSync(new URL(`./fixtures/k2-${name}.json`, import.meta.url), "utf8"),
    );
    const schema = nativeResponseSchema(
      name === "roster" ? "ducts.snapshot.roster" : "ducts.snapshot.walk",
    );
    expect(schema.parse(JSON.parse(JSON.stringify(payload)))).toEqual(payload);
    const broken = structuredClone(payload);
    broken.document.readAt = "yesterday";
    expect(schema.safeParse(broken).success).toBe(false);
  },
);

test("generated native decoders reject invalid payloads", () => {
  expect(nativeResponseSchema("revit.matrix.loaded-families").safeParse(null).success).toBe(false);
  expect(nativeRequestSchema("revit.matrix.loaded-families").safeParse(null).success).toBe(false);
  expect(
    nativeResponseDefinitionSchema(
      "revit.matrix.loaded-families",
      "FamilySnapshotRecord",
    ).safeParse(null).success,
  ).toBe(false);
});

test("Effect decode failures stay inside Zod safeParse during render", () => {
  const decoder = effectDecoder(Schema.Struct({ key: Schema.String }));
  for (const input of [undefined, null, {}, { key: 42 }]) {
    const result = decoder.safeParse(input);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues[0]?.code).toBe("custom");
  }
  expect(decoder.safeParse({ key: "valid" })).toEqual({ success: true, data: { key: "valid" } });
});

test("generated defaults survive nested object and array decoding", () => {
  const schema = generatedJsonSchema({
    type: "object",
    required: ["rows"],
    properties: {
      rows: {
        type: "array",
        default: [],
        items: {
          type: "object",
          required: ["count"],
          properties: { count: { type: "number", default: 3 } },
        },
      },
    },
  });
  expect(schema.parse({})).toEqual({ rows: [] });
  expect(schema.parse({ rows: [{}] })).toEqual({ rows: [{ count: 3 }] });
});
