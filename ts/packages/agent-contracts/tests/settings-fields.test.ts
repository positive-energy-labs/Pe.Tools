import { expect, test } from "vite-plus/test";
import {
  familyEvidenceSchema,
  settingsCandidate,
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
  });
  expect(parsed.proposal?.sources).toHaveLength(2);
});

test("a malformed citation is rejected", () => {
  const result = settingsFieldStateSchema.safeParse({
    proposal: { value: "24in", sources: [{ rowIdx: 2 }] },
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
    reading: {
      at: "C:\\Families\\PE VAV.rfa",
      version: "v7",
      observedAt: "2026-07-16T00:00:00Z",
    },
    origin: "build",
    familyName: "PE VAV",
    rfaPath: "C:\\Families\\PE VAV.rfa",
  });
  if (!("parameters" in parsed)) throw new Error("expected the fixture evidence arm");
  expect(parsed.parameters[0].valuesPerType.Standard.value).toBe("21in");
});

test("a raw draft is the base and staged fields apply on top of it", () => {
  const basis = '{\n\t"$preset": "@local/base.json",\n\t"a": 1\n}\n';
  const draft = '{\n\t"$preset": "@local/base.json",\n\t"a": 1,\n\t"b": 3\n}\n';
  const staged = { "/a": { staged: { value: 2 } } };
  expect(
    JSON.parse(settingsCandidate(basis, { ...staged, "": { staged: { value: draft } } })),
  ).toEqual({
    $preset: "@local/base.json",
    a: 2,
    b: 3,
  });
  // Alone, the raw draft is written byte for byte; so is an untouched basis.
  expect(settingsCandidate(basis, { "": { staged: { value: draft } } })).toBe(draft);
  expect(settingsCandidate(basis, {})).toBe(basis);
});

test("a staged field whose container the draft removed refuses, naming the pointer", () => {
  const basis = '{"Fields":[{"Header":"x"}]}';
  const fields = {
    "/Fields/0/Header": { staged: { value: "y" } },
    "": { staged: { value: '{"Other":1}' } },
  };
  expect(() => settingsCandidate(basis, fields)).toThrow(
    "Staged field /Fields/0/Header no longer resolves in the edited draft.",
  );
  // A field the basis never held either is still created, as without a draft.
  expect(
    JSON.parse(
      settingsCandidate("{}", {
        "/revit/units": { staged: { value: 1 } },
        "": { staged: { value: '{"k":0}' } },
      }),
    ),
  ).toEqual({ k: 0, revit: { units: 1 } });
});
