import { describe, expect, it } from "vite-plus/test";

import type { FamilyTypesParam } from "@pe/agent-contracts";

import { analyzeFormula, validateFormula } from "./formula.ts";

function p(name: string, extra: Partial<FamilyTypesParam> = {}): FamilyTypesParam {
  return {
    name,
    isInstance: false,
    isReadOnly: false,
    storageType: "Double",
    valuesPerType: {},
    ...extra,
  };
}

const PARAMS: FamilyTypesParam[] = [
  p("Width"),
  p("Width Offset"), // overlapping name — must mask before "Width"
  p("Depth"),
  p("Height", { formula: 'Depth + 10"' }),
  p("Clearance", { isInstance: true }),
];

describe("analyzeFormula", () => {
  it("finds referenced parameters, ignoring functions and numbers", () => {
    const { refs, unknown } = analyzeFormula(
      "round(Width + Depth * 2)",
      PARAMS.map((x) => x.name),
    );
    expect(refs.sort()).toEqual(["Depth", "Width"]);
    expect(unknown).toEqual([]);
  });

  it("masks the longest overlapping name first", () => {
    const { refs, unknown } = analyzeFormula(
      "Width Offset + 1",
      PARAMS.map((x) => x.name),
    );
    expect(refs).toEqual(["Width Offset"]);
    expect(unknown).toEqual([]);
  });

  it("strips string literals before tokenizing", () => {
    const { unknown } = analyzeFormula(
      'if(Width > 0, "Bogus Token", Depth)',
      PARAMS.map((x) => x.name),
    );
    expect(unknown).toEqual([]);
  });

  it("flags an unknown reference", () => {
    const { unknown } = analyzeFormula(
      "Widht + Depth",
      PARAMS.map((x) => x.name),
    );
    expect(unknown).toEqual(["Widht"]);
  });

  it("does not treat unit-suffixed numbers as references", () => {
    const { unknown } = analyzeFormula(
      'Depth + 10"',
      PARAMS.map((x) => x.name),
    );
    expect(unknown).toEqual([]);
  });
});

describe("validateFormula", () => {
  it("passes a clean formula", () => {
    expect(validateFormula({ paramName: "Height", draft: 'Depth + 12"', params: PARAMS })).toEqual(
      [],
    );
  });

  it("reports an invalid reference with its token", () => {
    const problems = validateFormula({ paramName: "Height", draft: "Widht + 1", params: PARAMS });
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatchObject({ kind: "invalid-ref", token: "Widht" });
  });

  it("detects direct self-reference", () => {
    const problems = validateFormula({ paramName: "Height", draft: "Height + 1", params: PARAMS });
    expect(problems.some((x) => x.kind === "cycle")).toBe(true);
  });

  it("detects a transitive cycle through the draft", () => {
    // Width's live formula reads Height; making Height read Width closes the loop.
    const params = PARAMS.map((x) => (x.name === "Width" ? p("Width", { formula: "Height" }) : x));
    const problems = validateFormula({ paramName: "Height", draft: "Width + 1", params });
    expect(problems.some((x) => x.kind === "cycle")).toBe(true);
  });

  it("does not flag an acyclic dependency", () => {
    const problems = validateFormula({ paramName: "Height", draft: "Depth", params: PARAMS });
    expect(problems).toEqual([]);
  });

  it("forbids a type parameter reading an instance parameter", () => {
    const problems = validateFormula({
      paramName: "Height",
      draft: "Clearance + 1",
      params: PARAMS,
    });
    expect(problems.some((x) => x.kind === "type-refs-instance")).toBe(true);
  });

  it("allows an instance parameter to read anything", () => {
    const params = PARAMS.map((x) => (x.name === "Height" ? p("Height", { isInstance: true }) : x));
    const problems = validateFormula({ paramName: "Height", draft: "Clearance + 1", params });
    expect(problems).toEqual([]);
  });
});
