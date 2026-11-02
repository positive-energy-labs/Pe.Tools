import { Schema } from "effect";
import { expect, test } from "vite-plus/test";
import {
  effectDecoder,
  nativeRequestSchema,
  nativeResponseSchema,
  nativeResponseDefinitionSchema,
} from "./decoders.ts";
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
