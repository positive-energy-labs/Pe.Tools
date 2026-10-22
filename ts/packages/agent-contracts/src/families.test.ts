import { describe, expect, it } from "vite-plus/test";

import {
  familyCellKey,
  familiesExcluded,
  familiesIncluded,
  familiesRouteState,
  familyCellStateSchema,
  familyStagedPatch,
} from "./families.ts";

describe("familiesRouteState", () => {
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
