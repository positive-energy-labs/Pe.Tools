import { expect, test } from "vite-plus/test";
import { settingsCandidate } from "../src/index.ts";

test("a raw draft is the base and staged fields apply on top of it", () => {
  const basis = '{\n\t"$preset": "@local/base.json",\n\t"a": 1\n}\n';
  const draft = '{\n\t"$preset": "@local/base.json",\n\t"a": 1,\n\t"b": 3\n}\n';
  const edit = { "/a": { edit: { by: "human" as const, value: 2 } } };
  expect(JSON.parse(settingsCandidate(basis, { ...edit, "": { edit: { by: "human" as const, value: draft } } }))).toEqual(
    {
      $preset: "@local/base.json",
      a: 2,
      b: 3,
    },
  );
  // Alone, the raw draft is written byte for byte; so is an untouched basis.
  expect(settingsCandidate(basis, { "": { edit: { by: "human" as const, value: draft } } })).toBe(draft);
  expect(settingsCandidate(basis, {})).toBe(basis);
});

test("a staged field whose container the draft removed refuses, naming the pointer", () => {
  const basis = '{"Fields":[{"Header":"x"}]}';
  const fields = {
    "/Fields/0/Header": { edit: { by: "human" as const, value: "y" } },
    "": { edit: { by: "human" as const, value: '{"Other":1}' } },
  };
  expect(() => settingsCandidate(basis, fields)).toThrow(
    "Staged field /Fields/0/Header no longer resolves in the edited draft.",
  );
  // A field the basis never held either is still created, as without a draft.
  expect(
    JSON.parse(
      settingsCandidate("{}", {
        "/revit/units": { edit: { by: "human" as const, value: 1 } },
        "": { edit: { by: "human" as const, value: '{"k":0}' } },
      }),
    ),
  ).toEqual({ k: 0, revit: { units: 1 } });
});
