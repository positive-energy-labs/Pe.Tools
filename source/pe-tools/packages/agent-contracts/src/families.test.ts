import { describe, expect, it } from "vite-plus/test";

import {
  familyCellAddress,
  familyCellKey,
  familiesExcluded,
  familiesIncluded,
  familiesRouteState,
} from "./families.ts";
import { applyPatches } from "./route-doc.ts";

describe("familiesRouteState", () => {
  it("is authored Work and nothing else: no plan, no receipts, no observation keys", () => {
    expect(familiesRouteState.schema.parse({})).toEqual({
      scope: {},
      excluded: {},
      cells: {},
    });
    // Old Work held a bare filter (or null) as its scope: it fails closed, never reads as unscoped.
    const filter = { categoryNames: [], familyNames: [], placementScope: "AllLoaded" };
    for (const scope of [null, filter])
      expect(familiesRouteState.schema.safeParse({ scope }).success).toBe(false);
    // Pea may propose, but only a person stages: the scope too (F-J1-10).
    expect(familiesRouteState.agentWriteMask).toEqual([
      ["scope", "proposal"],
      ["excluded"],
      ["cells", "*", "proposal"],
      ["executionOptions"],
    ]);
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
      changes: [{ section: "types", key: "W", kind: "set" }],
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
