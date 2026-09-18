/**
 * The projection, both directions, against the SHOWCASE model.
 *
 * The fixture below is a showcase family in the current `FamilyModel` shape: datums, a labeled
 * reference plane, macro forms and connectors on faces and planes. Typed rather than `any`, so a
 * schema change that would break the real document breaks this file first.
 *
 * WHAT IS ACTUALLY UNDER TEST is the claim phase B rests on: the page's world and the document are
 * the same family, read twice. So the forward direction is checked for the shapes the surface
 * indexes (rows, ghosts, bindings, the derived/live verdicts) and the reverse for the exact JSON
 * Pointers a save will write — because a pointer that is one segment wrong writes silently into a
 * file that will still parse.
 */
import { describe, expect, it } from "vite-plus/test";
import { address } from "@pe/agent-contracts";

import { buildSheet, planeGeos, type FamilyModel } from "./family-model.ts";
import type { EvidenceSlice } from "./host.ts";
import { buildFamilyPageModel, ghostRows, initialDraft, type Draft } from "./model.ts";
import { familyEditBuffer } from "./edit-buffer";
import { draftToPatches, draftedModel, projectFamilyModel } from "./project.ts";

const L = "Length (Common)";

const CLR = "Center (Left/Right)";
const CFB = "Center (Front/Back)";
const LEVEL = "Ref. Level";

const SHOWCASE: FamilyModel = {
  family: {
    name: "PE Family Model Showcase",
    category: "Generic Models",
    template: "Generic Model",
    placement: "Unhosted",
  },
  parameters: {
    "Body Width": { dataType: L, value: "24in" },
    "Body Depth": { dataType: L, value: "18in" },
    "Body Height": { dataType: L, value: "30in" },
    "Top Diameter": { dataType: L, value: "8in" },
    "Top Height": { dataType: L, value: "4in" },
    "Core Diameter": { dataType: L, value: "3in" },
    "Core Height": { dataType: L, formula: "Body Height + Top Height" },
    "Return Elevation": { dataType: L, value: "15in" },
    "Round Duct Diameter": { dataType: L, value: "6in" },
    "Rect Duct Width": { dataType: L, value: "10in" },
    "Rect Duct Height": { dataType: L, value: "6in" },
  },
  types: {
    Compact: { "Body Width": "18in", "Body Depth": "14in", "Body Height": "24in" },
    Standard: {},
    Tall: { "Body Height": "42in", "Return Elevation": "24in" },
  },
  datums: {
    [LEVEL]: { normal: "Z", isLevel: true },
    [CLR]: { normal: "X" },
    [CFB]: { normal: "Y" },
  },
  refPlanes: { "return-elevation": { normal: "PlusZ", at: "15in" } },
  dimensions: {
    "return-elevation": { between: [LEVEL, "return-elevation"], label: "Return Elevation" },
  },
  forms: {
    body: {
      kind: "Prism",
      center: [CLR, CFB],
      bottom: LEVEL,
      width: "param:Body Width",
      depth: "param:Body Depth",
      height: "param:Body Height",
    },
    "top-neck": {
      kind: "Cylinder",
      center: [CLR, CFB],
      bottom: LEVEL,
      diameter: "param:Top Diameter",
      height: "param:Top Height",
    },
    "core-bore": {
      kind: "Cylinder",
      void: true,
      center: [CLR, CFB],
      bottom: LEVEL,
      diameter: "param:Core Diameter",
      height: "param:Core Height",
    },
  },
  connectors: {
    "supply-air": {
      domain: "Duct",
      on: "body.top",
      at: [CLR, CFB],
      shape: "Round",
      diameter: "param:Round Duct Diameter",
      systemType: "SupplyAir",
      flowDirection: "Out",
    },
    "return-air": {
      domain: "Duct",
      on: "body.back",
      at: [CLR, "return-elevation"],
      shape: "Rectangular",
      width: "param:Rect Duct Width",
      height: "param:Rect Duct Height",
      systemType: "ReturnAir",
      flowDirection: "In",
    },
  },
};

const world = () =>
  buildFamilyPageModel(projectFamilyModel(SHOWCASE, null, { path: "showcase-spike.json" }));

/** The page's own edit channel, condensed: clone the baseline and mutate it like a verb would. */
function edited(fn: (draft: Draft) => void): { draft: Draft; baseline: Draft } {
  const baseline = initialDraft(world());
  const draft = structuredClone(baseline);
  fn(draft);
  return { draft, baseline };
}

describe("projectFamilyModel — document → page world", () => {
  it("carries the family's identity onto the profile the sentence names", () => {
    const proto = projectFamilyModel(SHOWCASE, null, { path: "showcase-spike.json" });
    expect(proto.profile.path).toBe("showcase-spike.json");
    expect(proto.profile.familyName).toBe("PE Family Model Showcase");
    expect(proto.profile.category).toBe("Generic Models");
    expect(proto.profile.placement).toBe("Unhosted");
  });

  it('spells a formula "= <text>", which is the page\'s ONE reading of "derived"', () => {
    const params = projectFamilyModel(SHOWCASE, null).profile.params;
    expect(params.find((p) => p.name === "Core Height")?.value).toBe("= Body Height + Top Height");
    expect(params.find((p) => p.name === "Body Width")?.value).toBe("24in");
  });

  it("passes the type matrix through verbatim — the spread is the audit", () => {
    const page = world();
    expect(page.typeNames).toEqual(["Compact", "Standard", "Tall"]);
    expect(page.mergeAnchor).toBe("Compact");
    expect(page.source.profile.types.Tall).toEqual({
      "Body Height": "42in",
      "Return Elevation": "24in",
    });
  });

  it("projects each form's authored dims, keeping the RAW binding as the value", () => {
    const body = world().geomBySlug.get("body");
    expect(body?.kind).toBe("Prism");
    expect(body?.dims.map((dim) => [dim.property, dim.binding])).toEqual([
      ["width", "param:Body Width"],
      ["depth", "param:Body Depth"],
      ["height", "param:Body Height"],
    ]);
    // A dim inherits its PARAMETER's dataType, so the bind picker's candidate filter can match.
    expect(body?.dims.every((dim) => dim.dataType === L)).toBe(true);
  });

  it("reads the plane references a constituent sits on into a row nothing can drive", () => {
    const byKey = (slug: string) =>
      Object.fromEntries(
        (world().geomBySlug.get(slug)?.meta ?? []).map((entry) => [entry.key, entry]),
      );
    expect(byKey("supply-air").on?.control).toBe("read");
    expect(byKey("supply-air").on?.value).toBe(`body.top / ${CLR} / ${CFB}`);
    expect(byKey("body").center?.value).toBe(`${CLR} / ${CFB} / ${LEVEL}`);
  });

  it("gives a connector its dims and only the metadata the file authors", () => {
    const supply = world().geomBySlug.get("supply-air");
    expect(supply?.kind).toBe("DuctConnector");
    expect(supply?.dims.map((dim) => [dim.property, dim.binding])).toEqual([
      ["diameter", "param:Round Duct Diameter"],
    ]);

    const byKey = Object.fromEntries((supply?.meta ?? []).map((entry) => [entry.key, entry]));
    expect(byKey.flowDirection?.control).toBe("toggle");
    expect(byKey.flowDirection?.value).toBe("Out");
    expect(byKey.systemType?.control).toBe("select");
    // The authored value is always selectable, whatever the fixed per-domain list says.
    expect(byKey.systemType?.options).toContain("SupplyAir");
    // Rectangular connectors carry two dims instead of a diameter.
    expect(
      world()
        .geomBySlug.get("return-air")
        ?.dims.map((dim) => dim.property),
    ).toEqual(["width", "height"]);
  });

  it("says what each constituent IS in one prose line", () => {
    const profile = projectFamilyModel(SHOWCASE, null).profile;
    expect(profile.solids.body).toBe("Prism · Body Width × Body Depth × Body Height");
    expect(profile.solids["core-bore"]).toBe("Cylinder · Core Diameter × Core Height");
    expect(profile.connectors["supply-air"]).toBe(
      "Duct · Round · Round Duct Diameter · SupplyAir · out",
    );
    expect(profile.connectors["return-air"]).toBe(
      "Duct · Rectangular · Rect Duct Width × Rect Duct Height · ReturnAir · in",
    );
  });

  it("leaves every dim of a fully-parameterised family off the ghost list", () => {
    const page = world();
    expect(ghostRows(page, initialDraft(page))).toEqual([]);
  });

  it("surfaces a frozen literal as a ghost row the moment the document has one", () => {
    const frozen: FamilyModel = {
      ...SHOWCASE,
      forms: {
        ...SHOWCASE.forms,
        "core-bore": { ...SHOWCASE.forms!["core-bore"]!, diameter: "3in" },
      },
    };
    const page = buildFamilyPageModel(projectFamilyModel(frozen, null));
    expect(ghostRows(page, initialDraft(page)).map((row) => row.name)).toEqual([
      "core-bore.diameter",
    ]);
  });

  it("claims no live substrate without evidence — silence, not an empty read", () => {
    expect(projectFamilyModel(SHOWCASE, null).live).toBeNull();
    // And nothing page-scoped is invented from the document either.
    expect(projectFamilyModel(SHOWCASE, null).spec).toBeNull();
    expect(projectFamilyModel(SHOWCASE, null).proposals).toEqual([]);
  });
});

describe("projectFamilyModel — evidence → the live substrate", () => {
  const evidence: EvidenceSlice = {
    typeNames: ["Compact", "Standard", "Tall"],
    parameters: [
      {
        name: "Body Height",
        isShared: false,
        valuesPerType: {
          Compact: { value: "24in", source: "AuthoredTypeOverride", provenance: "Exact" },
          Standard: { value: "30in", source: "AuthoredGlobal", provenance: "Exact" },
          Tall: { value: "40in", source: "AuthoredTypeOverride", provenance: "Exact" },
        },
      },
      {
        name: "Core Height",
        isShared: false,
        valuesPerType: {
          Standard: { value: "34in", source: "Formula", provenance: "Exact" },
        },
      },
      {
        name: "Keynote",
        isShared: false,
        valuesPerType: {
          Standard: { value: "K-1", source: "RevitDefault", provenance: "Exact" },
        },
      },
    ],
    diagnostics: [],
    reading: {
      at: address("C:\\Models\\office-tower.rvt"),
      version: "v1",
      observedAt: new Date().toISOString(),
    },
    origin: "capture",
    familyName: "PE Family Model Showcase",
    rfaPath: "office-tower.rvt",
  };

  it("reads values per type and marks a FORMULA's number read-only", () => {
    const live = projectFamilyModel(SHOWCASE, evidence).live;
    expect(live?.values["Body Height"]?.Tall).toEqual({ value: "40in" });
    expect(live?.values["Core Height"]?.Standard).toEqual({ value: "34in", readOnly: true });
    expect(live?.worldLabel).toBe("office-tower.rvt");
    expect(live?.readAgo).toBe("just now");
  });

  it("partitions the two only-one-side cases, and never accuses a formula of being missing", () => {
    const live = projectFamilyModel(SHOWCASE, evidence).live;
    expect(live?.extraParams).toEqual(["Keynote"]);
    expect(live?.missingParams).toContain("Body Width");
    expect(live?.missingParams).not.toContain("Core Height");
  });
});

describe("draftToPatches — draft → staged field patches", () => {
  it("stages nothing when the draft is the document", () => {
    const page = world();
    const baseline = initialDraft(page);
    expect(draftToPatches(SHOWCASE, baseline, baseline)).toEqual([]);
  });

  it("an emptied type override is still that override's value: it stages the empty string", () => {
    const typeName = Object.keys(initialDraft(world()).types)[0]!;
    const { draft, baseline } = edited((d) => {
      d.types[typeName] = { ...d.types[typeName], "Body Width": "" };
    });
    expect(draftToPatches(SHOWCASE, draft, baseline)).toContainEqual({
      path: ["fields", `/types/${typeName}/Body Width`, "staged"],
      value: { value: "" },
    });
  });

  it("writes a family value to /parameters/<name>/value", () => {
    const { draft, baseline } = edited((d) => {
      d.authored["Body Width"] = "26in";
    });
    expect(draftToPatches(SHOWCASE, draft, baseline)).toEqual([
      {
        path: ["fields", "/parameters/Body Width/value", "staged"],
        value: { value: "26in" },
      },
    ]);
  });

  it("writes a formula to /formula, stripping the page's leading =", () => {
    const { draft, baseline } = edited((d) => {
      d.authored["Core Height"] = "= Body Height * 2";
    });
    expect(draftToPatches(SHOWCASE, draft, baseline)).toEqual([
      {
        path: ["fields", "/parameters/Core Height/formula", "staged"],
        value: { value: "Body Height * 2" },
      },
    ]);
  });

  it("keeps value XOR formula: typing a formula over a value DELETES the value", () => {
    const { draft, baseline } = edited((d) => {
      d.authored["Body Width"] = "= Body Depth + 6in";
    });
    expect(draftToPatches(SHOWCASE, draft, baseline)).toEqual([
      {
        path: ["fields", "/parameters/Body Width/formula", "staged"],
        value: { value: "Body Depth + 6in" },
      },
      { path: ["fields", "/parameters/Body Width/value", "staged"], value: { delete: true } },
    ]);
  });

  it("sets a type override, and DELETES the property when the type goes back to inheriting", () => {
    const set = edited((d) => {
      d.types.Standard = { ...d.types.Standard, "Body Width": "25in" };
    });
    expect(draftToPatches(SHOWCASE, set.draft, set.baseline)).toEqual([
      { path: ["fields", "/types/Standard/Body Width", "staged"], value: { value: "25in" } },
    ]);

    const cleared = edited((d) => {
      delete d.types.Tall!["Return Elevation"];
    });
    expect(draftToPatches(SHOWCASE, cleared.draft, cleared.baseline)).toEqual([
      { path: ["fields", "/types/Tall/Return Elevation", "staged"], value: { delete: true } },
    ]);
  });

  it("routes a geometry dim to its own path — a form's, and a connector's", () => {
    const form = edited((d) => {
      d.geom.body!.dims.width = "30in";
    });
    expect(draftToPatches(SHOWCASE, form.draft, form.baseline)).toEqual([
      { path: ["fields", "/forms/body/width", "staged"], value: { value: "30in" } },
    ]);

    const connector = edited((d) => {
      d.geom["return-air"]!.dims.width = "12in";
    });
    expect(draftToPatches(SHOWCASE, connector.draft, connector.baseline)).toEqual([
      { path: ["fields", "/connectors/return-air/width", "staged"], value: { value: "12in" } },
    ]);
  });

  it("stages the EDITABLE metadata and silently stages nothing for a reported one", () => {
    const { draft, baseline } = edited((d) => {
      d.geom["supply-air"]!.meta.flowDirection = "In";
      d.geom["supply-air"]!.meta.systemType = "ExhaustAir";
      // `on` is reported from the sketch — no document path, so no patch may exist for it.
      d.geom["supply-air"]!.meta.on = "body.front";
    });
    expect(draftToPatches(SHOWCASE, draft, baseline)).toEqual([
      {
        path: ["fields", "/connectors/supply-air/flowDirection", "staged"],
        value: { value: "In" },
      },
      {
        path: ["fields", "/connectors/supply-air/systemType", "staged"],
        value: { value: "ExhaustAir" },
      },
    ]);
  });

  it("promotes a frozen literal into a whole new parameter AND rebinds the dim to it", () => {
    const frozen: FamilyModel = {
      ...SHOWCASE,
      forms: {
        ...SHOWCASE.forms,
        "core-bore": { ...SHOWCASE.forms!["core-bore"]!, diameter: "3in" },
      },
    };
    const page = buildFamilyPageModel(projectFamilyModel(frozen, null));
    const baseline = initialDraft(page);
    const draft = structuredClone(baseline);
    // Exactly what `bindToNew` does: keep the literal as the new parameter's family value, so the
    // geometry is byte-identical afterwards and only its reachability changed.
    draft.authored["Core Bore Diameter"] = "3in";
    draft.newParams = [{ name: "Core Bore Diameter", dataType: L, group: "geometry" }];
    draft.geom["core-bore"]!.dims.diameter = "param:Core Bore Diameter";

    expect(draftToPatches(frozen, draft, baseline)).toEqual([
      {
        path: ["fields", "/parameters/Core Bore Diameter", "staged"],
        value: {
          value: { dataType: L, propertiesGroup: "geometry", value: "3in" },
        },
      },
      {
        path: ["fields", "/forms/core-bore/diameter", "staged"],
        value: { value: "param:Core Bore Diameter" },
      },
    ]);
  });
});

describe("draftedModel — the draft laid over the document, for the drawing", () => {
  it("an untouched draft draws the document exactly", () => {
    const page = world();
    expect(draftedModel(SHOWCASE, initialDraft(page), page)).toEqual(SHOWCASE);
  });

  it("an edited Body Width moves the drawn rect", () => {
    const page = world();
    const { draft } = edited((d) => {
      d.authored["Body Width"] = "30in";
    });
    const sheet = buildSheet(draftedModel(SHOWCASE, draft, page), "Standard");
    expect(sheet.solids.find((solid) => solid.slug === "body")?.box).toEqual({
      x: [-15, 15],
      y: [-9, 9],
      z: [0, 30],
    });
    // The type that OVERRIDES Body Width is unmoved — the family value is what was edited.
    const compact = buildSheet(draftedModel(SHOWCASE, draft, page), "Compact");
    expect(compact.solids.find((solid) => solid.slug === "body")?.box.x).toEqual([-9, 9]);
  });

  it("an edited labeled-dimension param moves the plane", () => {
    const page = world();
    const { draft } = edited((d) => {
      d.types.Standard = { ...d.types.Standard, "Return Elevation": "20in" };
    });
    const planes = planeGeos(draftedModel(SHOWCASE, draft, page), "Standard");
    expect(planes.find((plane) => plane.slug === "return-elevation")?.offset).toBe(20);
    expect(planes.find((plane) => plane.slug === "return-elevation")?.param).toBe(
      "Return Elevation",
    );
    // The connector that sits on the plane follows it, on the body's back face.
    const sheet = buildSheet(draftedModel(SHOWCASE, draft, page), "Standard");
    expect(sheet.conns.find((conn) => conn.slug === "return-air")?.pos).toEqual({
      x: 0,
      y: 9,
      z: 20,
    });
    // Tall overrides the parameter, so its plane sits at its own number.
    const tall = planeGeos(SHOWCASE, "Tall");
    expect(tall.find((plane) => plane.slug === "return-elevation")?.offset).toBe(24);
  });

  it("a retyped geometry literal moves the form, through the same path a save writes", () => {
    const page = world();
    const { draft } = edited((d) => {
      d.geom.body!.dims.width = "36in";
    });
    const sheet = buildSheet(draftedModel(SHOWCASE, draft, page), "Standard");
    expect(sheet.solids.find((solid) => solid.slug === "body")?.box.x).toEqual([-18, 18]);
  });

  it("a promoted literal resolves through its NEW parameter, geometry unmoved", () => {
    const frozen: FamilyModel = {
      ...SHOWCASE,
      forms: {
        ...SHOWCASE.forms,
        "core-bore": { ...SHOWCASE.forms!["core-bore"]!, diameter: "3in" },
      },
    };
    const page = buildFamilyPageModel(projectFamilyModel(frozen, null));
    const draft = structuredClone(initialDraft(page));
    draft.authored["Core Bore Diameter"] = "3in";
    draft.newParams = [{ name: "Core Bore Diameter", dataType: L, group: "geometry" }];
    draft.geom["core-bore"]!.dims.diameter = "param:Core Bore Diameter";

    const drafted = draftedModel(frozen, draft, page);
    expect(drafted.parameters["Core Bore Diameter"]?.value).toBe("3in");
    expect(drafted.forms?.["core-bore"]?.diameter).toBe("param:Core Bore Diameter");
    // Byte-identical geometry: the drawn void is 3in before and after the promotion.
    const bore = buildSheet(drafted, "Standard").solids.find((s) => s.slug === "core-bore");
    expect(bore).toMatchObject({ isVoid: true, isCyl: true, box: { x: [-1.5, 1.5] } });
  });

  it("keeps value XOR formula", () => {
    const page = world();
    const formula = edited((d) => {
      d.authored["Core Height"] = "= Body Height * 2";
    });
    const drafted = draftedModel(SHOWCASE, formula.draft, page);
    expect(drafted.parameters["Core Height"]?.formula).toBe("Body Height * 2");
    expect(drafted.parameters["Core Height"]?.value).toBeUndefined();

    const value = edited((d) => {
      d.authored["Core Height"] = "40in";
    });
    const valued = draftedModel(SHOWCASE, value.draft, page);
    expect(valued.parameters["Core Height"]?.value).toBe("40in");
    expect(valued.parameters["Core Height"]?.formula).toBeUndefined();
  });

  it("lands editable connector metadata and refuses reported rows a home, in silence", () => {
    const page = world();
    const { draft } = edited((d) => {
      d.geom["supply-air"]!.meta.flowDirection = "In";
      d.geom["supply-air"]!.meta.systemType = "ExhaustAir";
      // `on` is reported from the sketch — no document path, so it must land nowhere.
      d.geom["supply-air"]!.meta.on = "body.front";
    });
    const drafted = draftedModel(SHOWCASE, draft, page);
    expect(drafted.connectors?.["supply-air"]?.flowDirection).toBe("In");
    expect(drafted.connectors?.["supply-air"]?.systemType).toBe("ExhaustAir");
    expect(drafted.connectors?.["supply-air"]?.on).toBe("body.top");
  });
});

it("keeps newer family input through an older acknowledgement, refusal and pane remount", async () => {
  const baseline = initialDraft(world());
  const first = structuredClone(baseline);
  first.authored["Body Width"] = "25in";
  const second = structuredClone(first);
  second.authored["Body Width"] = "26in";
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const revisions: number[] = [];
  const key = { route: "settings", target: null, work: "family-editor-retention-check" };
  const buffer = familyEditBuffer(key, async (_patches, revision) => {
    revisions.push(revision);
    if (revisions.length === 1) {
      await held;
      return null;
    }
    return { code: "failed", message: "temporary write failure" };
  });
  buffer.observe(10);
  buffer.stage(first, draftToPatches(SHOWCASE, first, baseline), 10);
  buffer.stage(second, draftToPatches(SHOWCASE, second, first), 10);
  const writing = buffer.flush();
  release();
  await expect(writing).rejects.toThrow("temporary write failure");
  expect(revisions).toEqual([10, 11]);
  expect(buffer.getSnapshot().draft).toBe(second);
  const remounted = familyEditBuffer(key, async (patches, revision) => {
    expect(revision).toBe(11);
    expect(patches).toEqual(draftToPatches(SHOWCASE, second, first));
    return null;
  });
  expect(remounted).toBe(buffer);
  await remounted.flush();
  expect(remounted.getSnapshot().draft).toBe(second);
  remounted.observe(12);
  expect(remounted.getSnapshot().draft).toBeNull();
});
