import { describe, expect, it } from "vite-plus/test";

import { fanCandidates } from "./fan-assignment.ts";
import {
  connOf,
  groupOf,
  nodeOf,
  snapshotOf,
  systemOf,
  type System,
} from "./test-snapshot.ts";

const unit = (id: number, ...classes: string[]) =>
  nodeOf(id, "equipment", {
    connectors: classes.map((classification, index) => connOf(index, null, { classification })),
  });
const group = (id: string, rootIds: number[], systemNames: string[]) =>
  groupOf(id, { rootIds, systemNames });
const system = (
  id: number,
  name: string,
  classification: string,
  baseEquipmentId: number | null = null,
) => systemOf(id, { name, classification, baseEquipmentId });

// FC-17 (17) roots SA 19 and RA 19; AHU (18) roots SA 19 too; FC-20 (20) is already SA 20's base.
const snapshot = (systems: System[]) =>
  snapshotOf({
    nodes: [
      unit(17, "SupplyAir", "ReturnAir"),
      unit(18, "SupplyAir"),
      unit(20, "SupplyAir"),
      nodeOf(5, "terminal"),
    ],
    groups: [
      group("g1", [17, 18], ["SA 19"]),
      group("g2", [17], ["RA 19"]),
      group("g3", [20], ["SA 20"]),
    ],
    systems,
    store: null,
  });

describe("fanCandidates", () => {
  it("offers the systems the unit's own groups carry, of a class its ports have, with no base yet", () => {
    const s = snapshot([
      system(19, "SA 19", "SupplyAir"),
      system(29, "RA 19", "ReturnAir"),
      system(20, "SA 20", "SupplyAir", 20),
      system(99, "SA 99", "SupplyAir"),
    ]);
    expect(fanCandidates(s, 17).map((c) => c.system)).toEqual(["RA 19", "SA 19"]);
    expect(fanCandidates(s, 17, "g1")).toEqual([{ unitId: 17, systemId: 19, system: "SA 19" }]);
    // A one-class unit is not offered a system of another class.
    expect(fanCandidates(s, 18).map((c) => c.system)).toEqual(["SA 19"]);
    // A system with base equipment is refused (no swap); a system the unit's groups do not carry is never offered.
    expect(fanCandidates(s, 20)).toEqual([]);
    expect(fanCandidates(s, 5)).toEqual([]);
  });
});
