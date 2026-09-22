import { readFileSync } from "node:fs";
import { expect, test } from "vite-plus/test";
import type { FamilySnapshot } from "#/family/host";
import { familySource } from "#/family/source";
import { buildSheet, inches, type FamilyModel } from "#/family/family-model";
import { initialDraft, rowAgreement } from "#/family/model";
import { draftToPatches } from "#/family/project";

const snapshot = (rawContent: string, composedContent = rawContent): FamilySnapshot => ({
  member: { pod: "demo", path: "test" },
  sha256: "1",
  observedAt: "2026-09-06T00:00:00Z",
  rawContent,
  composedContent,
  validation: { isValid: true, issues: [] },
});

test("native fixtures project parameters without inventing fixture content and author native paths", () => {
  for (const name of ["a-box", "b-grd", "c-bath-shower", "d-bath-shower-refline"]) {
    const raw = readFileSync(
      new URL(`../../../../../dotnet/Pe.Revit.Tests/Fixtures/FamilyModel/${name}.json`, import.meta.url),
      "utf8",
    );
    const input = snapshot(raw);
    const lane = familySource(input, null);
    expect(lane.parseError).toBeNull();
    expect(lane.world.params.length).toBe(Object.keys(JSON.parse(raw).parameters).length);
    expect(input.rawContent).toBe(raw);
    const baseline = initialDraft(lane.world);
    expect(draftToPatches(lane.document!.model, baseline, baseline)).toEqual([]);
    const edited = structuredClone(baseline);
    const param = lane.world.params[0]!.name;
    edited.authored[param] = "42in";
    expect(draftToPatches(lane.document!.model, edited, baseline)[0]!.path).toEqual([
      "cells",
      `/parameters/${param.replace(/~/g, "~0").replace(/\//g, "~1")}/value`,
      "staged",
    ]);
  }
});

test("lane reads composition and uses fixtures only on explicit request", () => {
  const raw = '{"family":{"name":"Composed"},"parameters":{"$preset":"@local/_params/width"}}';
  const lane = familySource(
    snapshot(
      raw,
      '{"family":{"name":"Composed"},"parameters":{"Width":{"dataType":"Length","value":24},"Enabled":{"dataType":"YesNo","value":false}}}',
    ),
    null,
  );
  expect(lane.world.params[0]?.value).toBe("24");
  expect(lane.world.params[1]?.value).toBe("No");
  expect(
    rowAgreement(lane.world, initialDraft(lane.world), {
      key: "Width",
      name: "Width",
      dataType: "Length",
      kind: "profile",
      group: "",
      isInstance: false,
    }),
  ).toBe("unread");
  expect(familySource(null, null).world.params).toEqual([]);
  expect(familySource(snapshot("bad json"), null).world.params).toEqual([]);
});

test("native capture projects only read values and gates missing claims on coverage", () => {
  const input = snapshot(
    '{"family":{"name":"Box"},"parameters":{"Width":{},"Missing":{},"Derived":{}},"types":{"Standard":{}}}',
  );
  const evidence = {
    observedAt: "2026-09-06T00:00:00Z",
    familyName: "Box",
    origin: "capture" as const,
    unmodeledCount: 1,
    coverage: { parameters: "Partial" },
    issues: [],
    modelJson:
      '{"parameters":{"Width":{},"Derived":{"formula":"Width * 2"}},"types":{"Standard":{"Width":12,"Derived":24}}}',
  };
  const partial = familySource(input, evidence).world.live!;
  expect(partial.values).toEqual({ Width: { Standard: { value: "12" } } });
  const parameterOnly = snapshot(
    '{"family":{"name":"Box"},"parameters":{"Width":{"value":"42in"}}}',
  );
  const lane = familySource(parameterOnly, {
    ...evidence,
    modelJson: '{"parameters":{"Width":{}},"types":{"Standard":{"Width":"24in"},"Empty":{}}}',
  });
  expect(lane.world.typeNames).toEqual(["Standard", "Empty"]);
  expect(lane.world.live?.values.Width?.Standard?.value).toBe("24in");
  expect(lane.world.source.profile.types).toEqual({});
  const draft = initialDraft(lane.world);
  expect(draft.types).toEqual({});
  expect(draftToPatches(lane.document!.model, draft, draft)).toEqual([]);
  expect(JSON.parse(parameterOnly.rawContent).types).toBeUndefined();
  expect(partial.missingParams).toEqual([]);
  expect(
    familySource(input, { ...evidence, coverage: { parameters: "Read" } }).world.live
      ?.missingParams,
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
    issues: [],
    origin: "capture" as const,
    observedAt: "2026-09-07T00:00:00Z",
  };
  const lane = familySource(null, evidence);
  expect(lane.document).toBeNull();
  expect(lane.world.params[0]?.name).toBe("Width");
  expect(lane.parseError).toBeNull();
  expect(lane.seedKey).toContain("capture:");
});

test("native source geometry resolves macros, seeds and labeled dimensions", () => {
  const source = (name: string): FamilyModel =>
    JSON.parse(
      readFileSync(
        new URL(`../../../../../dotnet/Pe.Revit.Tests/Fixtures/FamilyModel/${name}.json`, import.meta.url),
        "utf8",
      ),
    );
  const box = source("a-box");
  // Native datums are unsigned axes; signed ref-plane seeds retain their sign.
  for (const datum of Object.values(box.datums!))
    datum.normal = datum.normal.replace(/^(Plus|Minus)/, "");
  box.parameters!.Voltage!.value = "480 V";

  expect(buildSheet(box, "Standard").solids[0]).toMatchObject({
    slug: "body",
    box: { x: [-12, 12], y: [-4, 4], z: [0, 36] },
  });
  expect(buildSheet(box, "Standard").conns[0]?.pos).toEqual({ x: 0, y: 0, z: 36 });
  expect(buildSheet(box, "Wide").solids[0]?.box.x).toEqual([-18, 18]);
  const lane = familySource(snapshot(JSON.stringify(box)), null);
  const baseline = initialDraft(lane.world);
  const edit = structuredClone(baseline);
  edit.geom.body!.dims.width = "48in";
  expect(draftToPatches(box, edit, baseline)).toEqual([
    { path: ["cells", "/forms/body/width", "staged"], value: { value: "48in" } },
  ]);
  const grille = buildSheet(source("b-grd"), "24x12");
  expect(grille.solids[0]).toMatchObject({
    slug: "flange",
    box: { x: [-12, 12], y: [-6, 6], z: [0, 1] },
  });
  expect(grille.conns[0]).toMatchObject({ pos: { x: 0, y: 0, z: 1 }, w: 12, h: 8 });
  const bath = buildSheet(source("c-bath-shower"), "Bathtub Floor Mounted");
  expect(bath.solids).toEqual([]);
  // `conn top` is seeded at 12.5in, but its labeled dimension `_conn z offset` holds it at 1/2in.
  // The drain's x chains off a locked 3' plane through `_drain x offset`.
  expect(bath.conns.map((c) => [c.slug, c.pos.x, c.pos.y, c.pos.z])).toEqual([
    ["cold", -3, 0, 0.5],
    ["hot", 3, 0, 0.5],
    ["drain", 0, 24, 0.5],
  ]);
  expect(
    buildSheet(source("d-bath-shower-refline"), "Bathtub Floor Mounted").conns.map((c) => c.pos),
  ).toEqual([
    { x: -3, y: 0, z: 0.5 },
    { x: 3, y: 0, z: 0.5 },
  ]);
  expect(inches("-3in")).toBe(-3);
  expect(inches("3ft")).toBe(36);
  expect(inches("1/0in")).toBeNull();
  expect(inches("not a length")).toBeNull();
});

test("a captured family draws its extrusions from labeled planes, per type", () => {
  const captured: FamilyModel = JSON.parse(
    readFileSync(
      new URL(
        "../../../../../dotnet/Pe.Revit.Tests/Fixtures/FamilyModel/w6-revit-air-terminal.captured.json",
        import.meta.url,
      ),
      "utf8",
    ).replace(/^\uFEFF/, ""),
  );
  const box = (typeName: string, slug: string) => {
    const geo = buildSheet(captured, typeName).solids.find((solid) => solid.slug === slug)!.box;
    const round = (range: [number, number] | null) => range?.map((n) => Number(n.toFixed(4)));
    return { x: round(geo.x), y: round(geo.y), z: round(geo.z) };
  };
  // Duct Width and Duct Height label the neck's planes, so each type draws its own neck.
  expect(box("16x10", "extrusion").x).toEqual([-8, 8]);
  expect(box("16x10", "extrusion").y).toEqual([-5, 5]);
  expect(box("10x3", "extrusion").x).toEqual([-5, 5]);
  expect(box("10x3", "extrusion").y).toEqual([-1.5, 1.5]);
  expect(box("10x3", "extrusion").z).toEqual([0, 1.625]);
  // Grille Length is a formula the page does not evaluate, so the grille keeps its seeds.
  expect(box("10x3", "extrusion-2").x).toEqual([-8.6875, 8.6875]);
  expect(buildSheet(captured, "10x3").ghosts).toHaveLength(4);
});

test("offline shared declarations survive native projection and unrelated value edits", () => {
  const patch = JSON.parse(
    readFileSync(
      new URL(
        "../../../../../docs/features/family/acceptance/parameters.patch.json",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  const raw = JSON.stringify({
    family: { name: "PE Box" },
    parameters: patch.patch.parameters,
    types: { Standard: {} },
  });
  const lane = familySource(snapshot(raw), null);
  const shared = lane.world.params.find((p) => p.name === "FF_Route_Proof_Count")!;
  expect(shared.dataType).toBe("autodesk.spec.aec:number-2.0.0");
  expect(shared.value).toBe("7");
  const baseline = initialDraft(lane.world);
  const edit = structuredClone(baseline);
  edit.authored.Width = "48in";
  expect(draftToPatches(lane.document!.model, edit, baseline)).toEqual([
    { path: ["cells", "/parameters/Width/value", "staged"], value: { value: "48in" } },
  ]);
  expect(lane.document!.model.parameters!.FF_Route_Proof_Count).toEqual(
    patch.patch.parameters.FF_Route_Proof_Count,
  );
});
