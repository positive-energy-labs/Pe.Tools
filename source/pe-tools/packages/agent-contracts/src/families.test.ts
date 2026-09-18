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

  it("encodes the full address tuple without separator collisions", () => {
    const left = { familyId: 1, typeName: "a|b", parameter: "c" };
    const right = { familyId: 1, typeName: "a", parameter: "b|c" };
    expect(familyCellKey(left)).not.toBe(familyCellKey(right));
    expect(familyCellAddress(familyCellKey(left))).toEqual(left);
  });

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
