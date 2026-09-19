import { describe, expect, it } from "vite-plus/test";

import {
  familyCellAddress,
  familyCellKey,
  familiesExcluded,
  familiesIncluded,
  familiesRouteState,
} from "./families.ts";

describe("familiesRouteState", () => {
  it("is authored Work and nothing else: no plan, no receipts, no observation keys", () => {
    expect(familiesRouteState.schema.parse({})).toEqual({
      scope: null,
      excluded: {},
      cells: {},
    });
    // Pea may propose, but only a person stages.
    expect(familiesRouteState.agentWriteMask).toEqual([
      ["scope"],
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

  it("includes only unexcluded entries that have an effect and no refusal", () => {
    const entry = (familyId: number | null, planHash: string, over: Record<string, unknown> = {}) => ({
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
        entry(null, "h5", { familyName: "f5", refusals: [{ code: "family-not-found", path: "/", message: "no" }] }),
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
    // The pre-attribution array is old Work: it fails closed.
    expect(familiesRouteState.schema.safeParse({ excludedIds: [2] }).success).toBe(false);
  });
});
