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
  it("names the fans no system calls base equipment, and goes quiet once one does", () => {
    const before = snapshot([
      system(19, "SA 19", "SupplyAir"),
      system(29, "RA 19", "ReturnAir"),
      system(20, "SA 20", "SupplyAir", 20),
    ]);
    const roles = unitRoles(before, new Map(), {});
    expect(roles.get(17)?.reason).toBe("mixed port classes: moves air");
    expect([...fansOwedBase(before, roles).keys()]).toEqual([17, 18]);
    // After ducts.assign-fan, the snapshot names FC-17 SA 19's base: the role reads it, the verb is gone.
    const after = snapshot([
      system(19, "SA 19", "SupplyAir", 17),
      system(29, "RA 19", "ReturnAir"),
      system(20, "SA 20", "SupplyAir", 20),
    ]);
    const now = unitRoles(after, new Map(), {});
    expect(now.get(17)).toEqual({
      role: "fan",
      why: "proposed",
      reason: "base equipment of SA 19",
    });
    expect([...fansOwedBase(after, now).keys()]).toEqual([]);
  });

  it("leaves a passive unit out", () => {
    const s = snapshot([system(19, "SA 19", "SupplyAir")]);
    expect(fansOwedBase(s, new Map([[18, { role: "passive" as const }]]))).toEqual(new Map());
  });
});
