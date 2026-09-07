import { readFileSync } from "node:fs";
import { expect, test } from "vite-plus/test";
import { address } from "@pe/agent-contracts";
import type { FamilySnapshot } from "#/family/host";
import { familyLane } from "#/family/lane";
import { initialDraft } from "#/family/model";
import { draftToPatches } from "#/family/project";

const snapshot = (rawContent: string, composedContent = rawContent): FamilySnapshot => ({
  documentId: { moduleKey: "FamilyFoundry", rootKey: "models", relativePath: "test" },
  path: "test.json",
  versionToken: "1",
  observedAt: "2026-09-06T00:00:00Z",
  rawContent,
  composedContent,
  validation: { isValid: true, issues: [] },
});

test("native fixtures project parameters without inventing fixture content and author native paths", () => {
  for (const name of ["a-box", "b-grd", "c-bath-shower", "d-bath-shower-refline"]) {
    const raw = readFileSync(
      new URL(
        `../../../../../Pe.Revit.Tests/Fixtures/FamilyModel/${name}.family.json`,
        import.meta.url,
      ),
      "utf8",
    );
    const input = snapshot(raw);
    const lane = familyLane(input, null);
    expect(lane.parseError).toBeNull();
    expect(lane.fixture).toBe(false);
    expect(lane.world.params.length).toBe(Object.keys(JSON.parse(raw).parameters).length);
    expect(input.rawContent).toBe(raw);
    const baseline = initialDraft(lane.world);
    expect(draftToPatches(lane.document!.model, baseline, baseline)).toEqual([]);
    const edited = structuredClone(baseline);
    const param = lane.world.params[0]!.name;
    edited.authored[param] = "42in";
    expect(draftToPatches(lane.document!.model, edited, baseline)[0]!.path).toEqual([
      "fields",
      `/parameters/${param.replace(/~/g, "~0").replace(/\//g, "~1")}/value`,
      "staged",
    ]);
  }
});

test("lane reads composition and uses fixtures only on explicit request", () => {
  const raw = '{"family":{"name":"Composed"},"parameters":{"$preset":"@local/_params/width"}}';
  const lane = familyLane(
    snapshot(
      raw,
      '{"family":{"name":"Composed"},"parameters":{"Width":{"dataType":"Length","value":24},"Enabled":{"dataType":"YesNo","value":false}}}',
    ),
    null,
  );
  expect(lane.world.params[0]?.value).toBe("24");
  expect(lane.world.params[1]?.value).toBe("No");
  expect(familyLane(null, null).world.params).toEqual([]);
  expect(familyLane(snapshot("bad json"), null).world.params).toEqual([]);
  expect(familyLane(null, null, true).world.params.length).toBeGreaterThan(0);
});

test("native capture projects only read values and gates missing claims on coverage", () => {
  const input = snapshot(
    '{"family":{"name":"Box"},"parameters":{"Width":{},"Missing":{},"Derived":{}},"types":{"Standard":{}}}',
  );
  const evidence = {
    reading: {
      at: address("C:\\Models\\Box.rfa"),
      version: "v1",
      observedAt: "2026-09-06T00:00:00Z",
    },
    familyName: "Box",
    origin: "capture" as const,
    unmodeledCount: 1,
    coverage: { parameters: "Partial" },
    modelJson:
      '{"parameters":{"Width":{},"Derived":{"formula":"Width * 2"}},"types":{"Standard":{"Width":12,"Derived":24}}}',
  };
  const partial = familyLane(input, evidence).world.live!;
  expect(partial.values).toEqual({ Width: { Standard: { value: "12" } } });
  expect(partial.missingParams).toEqual([]);
  expect(
    familyLane(input, { ...evidence, coverage: { parameters: "Read" } }).world.live?.missingParams,
  ).toEqual(["Missing"]);
});

test("native capture without an authored file renders a read-only family lane", () => {
  const modelJson =
    '{"family":{"name":"Opened family","category":"GenericModels"},"parameters":{"Width":{"dataType":"Length","value":"24in"}},"types":{"Standard":{}}}';
  const evidence = {
    modelJson,
    familyName: "Opened family",
    coverage: { parameters: "Read" },
    unmodeledCount: 0,
    origin: "capture" as const,
    reading: {
      at: address("C:\\Models\\Opened.rfa"),
      version: "v1",
      observedAt: "2026-09-07T00:00:00Z",
    },
  };
  const lane = familyLane(null, evidence);
  expect(lane.fixture).toBe(false);
  expect(lane.document).toBeNull();
  expect(lane.world.params[0]?.name).toBe("Width");
  expect(lane.parseError).toBeNull();
  expect(lane.seedKey).toContain("capture:");
});
