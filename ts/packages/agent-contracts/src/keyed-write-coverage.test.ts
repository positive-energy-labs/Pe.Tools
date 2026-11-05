import { describe, expect, it } from "vite-plus/test";
import { catalogWorks } from "./catalog-work.ts";
import { commandCatalogAxes } from "./command-axes.ts";
import { commands } from "./semantic-actions.ts";

/**
 * K3 class-wide coverage: every ModelWrite command is discovered from the catalog axes, never listed by hand
 * elsewhere, and must name how omitted keys survive. A new ModelWrite with no entry here fails this test.
 *   catalog: a catalog Work owner; the per-owner falsifier in catalog-work.test.ts runs it.
 *   store: the native duct loss store; DuctStoreOverlayTests (deterministic) and DuctStoreOverlayReadbackTests (fresh).
 *   patch: the native op writes only the items it is sent; an omitted item is untouched (census source named).
 *   owed: omission semantics not yet proven; named here so it is visible, never silently skipped.
 */
type Coverage =
  | { catalog: keyof typeof catalogWorks }
  | { store: string }
  | { patch: string }
  | { owed: string };
const census = "WRITE-CENSUS.md";
const coverage: Record<string, Coverage> = {
  "data-table.apply": { catalog: "data-tables" },
  "parameter-links.apply": { catalog: "parameter-links" },
  "ducts.apply-losses": { store: "DuctApplier.Compose per-key overlay + DuctStoreDeletes" },
  "ducts.apply-heal": { patch: `${census} #14: connector joins named by element:index` },
  "ducts.apply-assign-fan": { patch: `${census} #15: one system/unit assignment` },
  "schedule.grid.push": { patch: `${census} #7: per-cell parameter writes of staged cells only` },
  "schedule.apply": { patch: `${census} #8: create-only schedule spec` },
  "takeoffs.adopt": { patch: `${census} #9: adopts the named elements` },
  "rooms.write": { patch: `${census} #18: writes the named regions by guid` },
  "rooms.draw": { patch: `${census} #17: creates the sent loops` },
  "family.build": { patch: `${census} #5: creates a family file from the authored spec` },
  "family.apply": { owed: "Family Foundry applies the whole authored spec; full-before disclosure unproven" },
  "families.apply": { owed: "Family Foundry applies the whole authored spec per family; full-before disclosure unproven" },
  "rooms.partition": { owed: "partition may replace a view's regions; omission semantics unproven" },
  "rooms.merge": { owed: "merges named regions; whether unnamed regions are rewritten is unproven" },
  "takeoffs.partition": { owed: "zone partition may replace a run's regions; omission semantics unproven" },
};

describe("keyed-record ModelWrite coverage", () => {
  const writes = Object.entries(commandCatalogAxes)
    .filter(([, axes]) => axes.effect === "ModelWrite")
    .map(([key]) => key)
    .sort();

  it("names every ModelWrite command's omission semantics", () => {
    expect(writes.filter((key) => !(key in coverage))).toEqual([]);
    expect(Object.keys(coverage).filter((key) => !writes.includes(key))).toEqual([]);
  });

  it("covers every catalog Work owner through its own generated apply", () => {
    for (const [owner] of Object.entries(catalogWorks)) {
      const apply = Object.entries(commands).find(
        ([, c]) => (c as { work?: { route: string }; writeBoundary?: { phase: string } }).work?.route === owner &&
          (c as { writeBoundary?: { phase: string } }).writeBoundary?.phase === "apply",
      )?.[0];
      expect(apply && coverage[apply], owner).toEqual({ catalog: owner });
    }
  });
});
