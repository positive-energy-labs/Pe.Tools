import { expect, test } from "vite-plus/test";
import {
  familyEvidenceSchema,
  settingsFieldPointer,
  settingsFieldSegments,
  settingsFieldStateSchema,
} from "../src/index.ts";

test("field pointers round-trip segments with periods, slashes, and tildes", () => {
  const segments = ["types", "Standard", "M.2 Depth", "a/b", "t~x"];
  const pointer = settingsFieldPointer(segments);
  expect(pointer).toBe("/types/Standard/M.2 Depth/a~1b/t~0x");
  expect(settingsFieldSegments(pointer)).toEqual(segments);
});

test("field segments reject non-pointer keys fail-fast", () => {
  expect(() => settingsFieldSegments("types.Standard.Width")).toThrow(/JSON Pointers/);
});

test("a proposal may carry multiple citations", () => {
  const parsed = settingsFieldStateSchema.parse({
    proposal: {
      value: "24in",
      sources: [
        { blockId: "b3", rowIdx: 2, colIdx: 4 },
        { blockId: "img-1", note: "dimension callout in figure" },
      ],
    },
    review: "none",
  });
  expect(parsed.proposal?.sources).toHaveLength(2);
});

test("a malformed citation is rejected", () => {
  const result = settingsFieldStateSchema.safeParse({
    proposal: { value: "24in", sources: [{ rowIdx: 2 }] },
    review: "none",
  });
  expect(result.success).toBe(false);
});

test("family evidence parses the C# projection shape with an origin stamp", () => {
  const parsed = familyEvidenceSchema.parse({
    typeNames: ["Standard"],
    parameters: [
      {
        name: "Width",
        isShared: false,
        valuesPerType: {
          Standard: { value: "21in", source: "AuthoredGlobal", provenance: "Exact" },
        },
      },
    ],
    diagnostics: [],
    from: {
      origin: "build",
      capturedAt: "2026-07-16T00:00:00Z",
      familyName: "PE VAV",
      documentVersionToken: "v7",
    },
  });
  expect(parsed.parameters[0].valuesPerType.Standard.value).toBe("21in");
});
