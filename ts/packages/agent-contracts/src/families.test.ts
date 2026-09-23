import { describe, expect, it } from "vite-plus/test";

import {
  familyCellAddress,
  familyCellKey,
  familiesExcluded,
  familiesIncluded,
  familiesRouteState,
  familyCellStateSchema,
  familyStagedPatch,
} from "./families.ts";
import { applyPatches } from "./route-doc.ts";
import { familyCaptureSchema } from "./family-actions.ts";

describe("familiesRouteState", () => {
  it("persists spec readings only with typed document blocks and images", () => {
    const reading = {
      kind: "spec",
      value: {
        fileName: "spec.pdf",
        blocks: [{ id: "b", page: 1, kind: "text", md: "Model" }],
        images: [{ id: "i", page: 1, category: "diagram" }],
      },
    };
    expect(familyCaptureSchema.shape.reading.parse(JSON.parse(JSON.stringify(reading)))).toEqual(
      reading,
    );
    expect(familyCaptureSchema.shape.reading.safeParse({ ...reading, value: 3 }).success).toBe(
      false,
    );
    expect(
      familyCaptureSchema.shape.reading.safeParse({
        ...reading,
        value: { ...reading.value, blocks: [{}] },
      }).success,
    ).toBe(false);
  });
  it("round-trips numeric-looking Text through staged Work into a Family Foundry patch", () => {
    const key = familyCellKey({ familyName: "F", typeName: "T", parameter: "Text" });
    const doc = familiesRouteState.schema.parse(
      JSON.parse(
        JSON.stringify({
          cells: { [key]: { staged: { value: { value: "3", storageType: "String" } } } },
        }),
      ),
    );
    const patch = JSON.parse(JSON.stringify(familyStagedPatch(doc.cells, "F")!.spec));
    expect(patch.patch.types.T.Text).toBe("3");
    expect(
      familiesRouteState.schema.safeParse({
        cells: { [key]: { staged: { value: { value: "3" } } } },
      }).success,
    ).toBe(false);
  });
  it("is authored Work and nothing else: no plan, no receipts, no observation keys", () => {
    expect(familiesRouteState.schema.parse({})).toEqual({
      scope: {},
      excluded: {},
      cells: {},
      patch: {},
      takenAt: null,
    });
    // Old Work held a bare filter (or null) as its scope: it fails closed, never reads as unscoped.
    const filter = { categoryNames: [], familyNames: [], placementScope: "AllLoaded" };
    for (const scope of [null, filter])
      expect(familiesRouteState.schema.safeParse({ scope }).success).toBe(false);
    // Pea may propose, but only a person stages: the scope too (F-J1-10).
    expect(familiesRouteState.agentWriteMask).toEqual([
      ["scope", "proposal"],
      ["patch", "proposal"],
      ["excluded"],
      ["cells", "*", "proposal"],
      ["executionOptions"],
    ]);
  });

  it("accepts a native patch proposal as exact supplied bytes but does not let Pea stage it", () => {
    const value = {
      path: "proposed/duct-patch.json",
      content: JSON.stringify({
        $schema: "https://host/schemas/settings/FamilyFoundry/patches.json",
        select: { names: ["Box", "Pipe"] },
        patch: { parameters: { Width: { formula: "NeckOuterW" } } },
      }),
    };
    const empty = familiesRouteState.schema.parse({});
    const proposed = applyPatches(
      familiesRouteState,
      { version: 1, revision: 0, doc: empty },
      "agent",
      [{ path: ["patch", "proposal"], value: { value } }],
      0,
    );
    expect(proposed.ok).toBe(true);
    expect(
      applyPatches(
        familiesRouteState,
        { version: 1, revision: 0, doc: empty },
        "agent",
        [{ path: ["patch", "staged"], value: { value } }],
        0,
      ).ok,
    ).toBe(false);
    expect(
      familiesRouteState.schema.safeParse({
        patch: { proposal: { value: { ...value, content: "{" } } },
      }).success,
    ).toBe(false);
  });

  it("encodes separator, quote, and unicode addresses as distinct canonical tuples", () => {
    const addresses = [
      { familyName: "F", typeName: "a|b", parameter: "c" },
      { familyName: "F", typeName: "a", parameter: "b|c" },
      { familyName: 'F"|', typeName: 'a"b', parameter: "Δ/水" },
    ];
    const keys = addresses.map(familyCellKey);
    expect(new Set(keys).size).toBe(addresses.length);
    expect(keys.map(familyCellAddress)).toEqual(addresses);
    for (const key of keys)
      expect(() =>
        familiesRouteState.schema.parse({ cells: { [key]: { proposal: null, staged: null } } }),
      ).not.toThrow();
  });

  // A number in the family slot is an element id: old id-keyed Work fails closed.
  it.each(["not json", "{}", '["F","T"]', '[1,"T","P"]', '["","T","P"]', '["F","T","P",4]'])(
    "rejects malformed cell key %s at the Work boundary",
    (key) => {
      expect(() =>
        familiesRouteState.schema.parse({ cells: { [key]: { proposal: null, staged: null } } }),
      ).toThrow("canonical [familyName,typeName,parameter] JSON tuple");
    },
  );

  it.each(['[ "F", "T", "P" ]', '["F","T","P"] '])(
    "rejects noncanonical alias %s for an existing address",
    (key) => {
      const canonical = familyCellKey({ familyName: "F", typeName: "T", parameter: "P" });
      expect(key).not.toBe(canonical);
      expect(familyCellAddress(key)).toEqual(familyCellAddress(canonical));
      expect(() =>
        familiesRouteState.schema.parse({
          cells: {
            [canonical]: { proposal: null, staged: null },
            [key]: { proposal: null, staged: null },
          },
        }),
      ).toThrow("canonical [familyName,typeName,parameter] JSON tuple");
    },
  );

  it("rejects persisted legacy arrays instead of stripping them", () => {
    expect(() => familiesRouteState.schema.parse({ edits: [], accepted: [] })).toThrow();
  });

  it("advertises no route command at all: reading and applying are host ports", () => {
    expect(Object.keys(familiesRouteState.commands)).toEqual([]);
  });

  it("keeps the person's pod choice and refuses an agent patch", () => {
    expect(familiesRouteState.schema.parse({ pod: "company" })).toMatchObject({ pod: "company" });
    expect(familiesRouteState.schema.safeParse({ pod: "" }).success).toBe(false);
    expect(
      applyPatches(
        familiesRouteState,
        { version: 1, revision: 0, doc: familiesRouteState.schema.parse({}) },
        "agent",
        [{ path: ["pod"], value: "x" }],
        0,
      ),
    ).toMatchObject({ ok: false, error: expect.stringContaining("not agent-writable") });
  });

  it("includes only unexcluded entries that have an effect and no refusal", () => {
    const entry = (
      familyId: number | null,
      planHash: string,
      over: Record<string, unknown> = {},
    ) => ({
      familyId,
      familyName: `f${familyId}`,
      planHash,
      changes: [{ section: "types", key: "W", kind: "set", before: "1in", after: "2in" }],
      runEffects: [],
      refusals: [],
      warnings: [],
      ...over,
    });
    const plan = {
      entries: [
        entry(1, "h1"),
        entry(2, "h2"),
        entry(3, "h3", { refusals: [{ code: "X", path: "/", message: "no" }] }),
        entry(4, "h4", { changes: [], runEffects: [] }),
        // A name the library could not resolve plans nothing.
        entry(null, "h5", {
          familyName: "f5",
          refusals: [{ code: "family-not-found", path: "/", message: "no" }],
        }),
      ],
    };
    expect(familiesIncluded(plan, { f2: { by: "pea" } })).toEqual({ "1": "h1" });
    expect(familiesIncluded(plan, {})).toEqual({ "1": "h1", "2": "h2" });
    expect(familiesExcluded(plan, { f2: { by: "pea" }, f9: { by: "person" } })).toEqual([
      { familyName: "f2", by: "pea" },
    ]);
    // An exclusion names a family, so it still excludes after an apply reloads it under a new id.
    const reloaded = { entries: [entry(7, "h7", { familyName: "f2" })] };
    expect(familiesIncluded(reloaded, { f2: { by: "person" } })).toEqual({});
    // An id-keyed exclusion is old Work: it fails closed rather than naming a family "2".
    expect(familiesRouteState.schema.safeParse({ excluded: { "2": { by: "pea" } } }).success).toBe(
      false,
    );
    // The pre-attribution array is old Work: it fails closed.
    expect(familiesRouteState.schema.safeParse({ excludedIds: [2] }).success).toBe(false);
  });
});

describe("familiesRouteState.salvage", () => {
  const bare = {
    categoryNames: ["Air Terminals"],
    familyNames: ["Alpha"],
    placementScope: "AllLoaded",
  };

  it("S-1: keeps name-keyed exclusions as names beside old ids", () => {
    expect(
      familiesRouteState.salvage({ scope: bare, excluded: { Alpha: { by: "person" } } }),
    ).toMatchObject({ familyNames: ["Alpha"], familyIds: [] });
    expect(
      familiesRouteState.salvage({ excluded: { "41": { by: "person" }, Beta: { by: "pea" } } }),
    ).toMatchObject({ familyNames: ["Beta"], familyIds: [41] });
    expect(familiesRouteState.salvage({ excludedIds: [3102, 7] })).toMatchObject({
      familyNames: [],
      familyIds: [3102, 7],
    });
  });

  it("S-2: offers the old bare scope, from any shape that held one, and none when there was none", () => {
    expect(familiesRouteState.salvage({ scope: bare })).toMatchObject({ scope: bare });
    expect(familiesRouteState.salvage({ plan: { scope: bare } })).toMatchObject({ scope: bare });
    expect(familiesRouteState.salvage({ scope: { staged: { value: bare } } })).toMatchObject({
      scope: bare,
    });
    for (const doc of [{ scope: null }, {}, { scope: { proposal: { value: bare } } }])
      expect(familiesRouteState.salvage(doc)).not.toHaveProperty("scope");
  });
});

describe("familyStagedPatch", () => {
  it("stages a measured cell as { value, unit } and the patch carries the object", () => {
    const key = familyCellKey({ familyName: "AHU", typeName: "A", parameter: "Airflow" });
    const cell = familyCellStateSchema.parse({
      staged: { value: { value: "300", unit: "CFM", storageType: "Double" } },
    });
    expect(cell.staged?.value).toEqual({ value: "300", unit: "CFM", storageType: "Double" });
    expect(familyStagedPatch({ [key]: cell }, "AHU")?.spec.patch.types).toEqual({
      A: { Airflow: { value: "300", unit: "CFM" } },
    });
  });
});
