import { describe, expect, it } from "vite-plus/test";

import {
  familyCellAddress,
  familyCellKey,
  familiesIncluded,
  familiesRouteState,
} from "./families.ts";

describe("familiesRouteState", () => {
  it("is authored Work and nothing else: no plan, no receipts, no observation keys", () => {
    expect(familiesRouteState.schema.parse({})).toEqual({
      scope: null,
      excludedIds: [],
      cells: {},
    });
    // Pea may propose, but only a person stages.
    expect(familiesRouteState.agentWriteMask).toEqual([
      ["scope"],
      ["excludedIds"],
      ["cells", "*", "proposal"],
      ["executionOptions"],
    ]);
  });

  it("encodes separator, quote, and unicode addresses as distinct canonical tuples", () => {
    const addresses = [
      { familyId: 1, typeName: "a|b", parameter: "c" },
      { familyId: 1, typeName: "a", parameter: "b|c" },
      { familyId: 1, typeName: 'a"b', parameter: "Δ/水" },
    ];
    const keys = addresses.map(familyCellKey);
    expect(new Set(keys).size).toBe(addresses.length);
    expect(keys.map(familyCellAddress)).toEqual(addresses);
    for (const key of keys)
      expect(() =>
        familiesRouteState.schema.parse({ cells: { [key]: { proposal: null, staged: null } } }),
      ).not.toThrow();
  });

  it.each(["not json", "{}", '[1,"T"]', '["1","T","P"]', '[1,"T","P",4]'])(
    "rejects malformed cell key %s at the Work boundary",
    (key) => {
      expect(() =>
        familiesRouteState.schema.parse({ cells: { [key]: { proposal: null, staged: null } } }),
      ).toThrow("canonical [familyId,typeName,parameter] JSON tuple");
    },
  );

  it.each(['[ 1, "T", "P" ]', '[1e0,"T","P"]'])(
    "rejects noncanonical alias %s for an existing address",
    (key) => {
      const canonical = familyCellKey({ familyId: 1, typeName: "T", parameter: "P" });
      expect(key).not.toBe(canonical);
      expect(familyCellAddress(key)).toEqual(familyCellAddress(canonical));
      expect(() =>
        familiesRouteState.schema.parse({
          cells: {
            [canonical]: { proposal: null, staged: null },
            [key]: { proposal: null, staged: null },
          },
        }),
      ).toThrow("canonical [familyId,typeName,parameter] JSON tuple");
    },
  );

  it("rejects persisted legacy arrays instead of stripping them", () => {
    expect(() => familiesRouteState.schema.parse({ edits: [], accepted: [] })).toThrow();
  });

  it("advertises no route command at all: reading and applying are host ports", () => {
    expect(Object.keys(familiesRouteState.commands)).toEqual([]);
  });

  it("includes only unexcluded entries that have an effect and no refusal", () => {
    const entry = (familyId: number, planHash: string, over: Record<string, unknown> = {}) => ({
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
      ],
    };
    expect(familiesIncluded(plan, [2])).toEqual({ "1": "h1" });
    expect(familiesIncluded(plan, [])).toEqual({ "1": "h1", "2": "h2" });
  });
});
