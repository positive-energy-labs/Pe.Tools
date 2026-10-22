import { describe, expect, it } from "vite-plus/test";

import { fanCandidates, fansOwedBase } from "./fan-assignment.ts";
import type { DuctSnapshot } from "./types.ts";
import { unitRoles } from "./unit-roles.ts";

const unit = (id: number, ...classes: string[]) => ({
  id,
  kind: "equipment",
  connectors: classes.map((classification, index) => ({ index, classification })),
  facts: [],
});
const group = (id: string, rootIds: number[], systemNames: string[]) => ({
  id,
  rootIds,
  systemNames,
  classifications: [],
});
const system = (
  id: number,
  name: string,
  classification: string,
  baseEquipmentId: number | null = null,
) => ({
  id,
  name,
  classification,
  baseEquipmentId,
});

// FC-17 (17) roots SA 19 and RA 19; AHU (18) roots SA 19 too; FC-20 (20) is already SA 20's base.
const snapshot = (systems: ReturnType<typeof system>[]) =>
  ({
    nodes: [
      unit(17, "SupplyAir", "ReturnAir"),
      unit(18, "SupplyAir"),
      unit(20, "SupplyAir"),
      { id: 5, kind: "terminal", connectors: [], facts: [] },
    ],
    segments: [],
    groups: [
      group("g1", [17, 18], ["SA 19"]),
      group("g2", [17], ["RA 19"]),
      group("g3", [20], ["SA 20"]),
    ],
    systems,
    store: null,
    slots: {},
  }) as unknown as DuctSnapshot;

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

describe("fansOwedBase", () => {
  it("offers a system once: to its network's lead fan, or to none when its fans sit in separate networks", () => {
    const s = snapshot([system(19, "SA 19", "SupplyAir")]);
    const roles = unitRoles(s, new Map(), {});
    const lead = fansOwedBase(s, roles, () => 17);
    expect([...lead.keys()]).toEqual([17]);
    // Two networks carry SA 19, each rooted at its own fan: split the system in Revit first.
    const twoNets = {
      ...s,
      groups: s.groups.flatMap((g) =>
        g.rootIds.includes(17) && g.rootIds.includes(18)
          ? [
              { ...g, id: "gA", rootIds: [17] },
              { ...g, id: "gB", rootIds: [18] },
            ]
          : [g],
      ),
    };
    const none = fansOwedBase(twoNets, roles, () => null);
    expect(none.get(17)?.some((a) => a.system === "SA 19") ?? false).toBe(false);
    expect(none.split?.get("SA 19")).toEqual([17, 18]);
  });
});
