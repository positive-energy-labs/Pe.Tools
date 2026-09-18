import { describe, expect, it } from "vite-plus/test";

import { at, drop, isAccepted, patchValue, put, stagedMembers } from "./staged.ts";

const now = new Date("2026-09-17T12:00:00.000Z");
const cell = (familyId: number, familyName: string, typeName: string, value: string) => ({
  familyId,
  familyName,
  typeName,
  parameter: "PE_G___Model",
  value,
  by: "pea" as const,
});

describe("staged cell edits", () => {
  it("holds one proposal per cell, drops by address, and accepts a value, not a cell", () => {
    const first = put([], cell(1, "A", "T1", "x"));
    const second = put(first, cell(1, "A", "T1", "y"));
    expect(second).toHaveLength(1);
    expect(at(second, cell(1, "A", "T1", ""))!.value).toBe("y");
    expect(drop(second, cell(1, "A", "T1", "y"))).toEqual([]);
    expect(drop(second, cell(2, "B", "T1", "y"))).toHaveLength(1);
    // An accept of "x" does not accept a later proposal of "y" on the same cell.
    expect(isAccepted(first, cell(1, "A", "T1", "x"))).toBe(true);
    expect(isAccepted(first, cell(1, "A", "T1", "y"))).toBe(false);
  });

  it("keeps a JSON scalar a scalar and everything else the typed text", () => {
    expect(patchValue("12")).toBe(12);
    expect(patchValue("true")).toBe(true);
    expect(patchValue("false")).toBe(false);
    expect(patchValue("FXMQ20")).toBe("FXMQ20");
    expect(patchValue("3' - 6\"")).toBe("3' - 6\"");
  });

  it("generates one patch member per family, each selecting exactly that family", () => {
    const members = stagedMembers(
      [cell(2, "Heat Pump", "HP-1", "RXL30"), cell(1, "Fan Coil", "FCU-1", "FXMQ20")],
      now,
      "http://localhost:5150/schemas/settings/FamilyFoundry/patches.json",
    );
    expect(members.map((member) => member.familyName)).toEqual(["Fan Coil", "Heat Pump"]);
    expect(members[0]!.path).toBe(
      "settings/families/staged-Fan-Coil-2026-09-17T12-00-00-000Z.json",
    );
    expect(JSON.parse(members[0]!.content)).toEqual({
      $schema: "http://localhost:5150/schemas/settings/FamilyFoundry/patches.json",
      select: { names: ["Fan Coil"] },
      patch: { types: { "FCU-1": { PE_G___Model: "FXMQ20" } } },
    });
    // The whole reason one member cannot hold both: `patch.types` is keyed by TYPE NAME and is
    // merged onto every family the select matches, creating types the other family never had.
    expect(JSON.parse(members[1]!.content).select).toEqual({ names: ["Heat Pump"] });
  });

  it("collects every cell of one family into that family's one member", () => {
    const members = stagedMembers(
      [
        cell(1, "Fan Coil", "FCU-1", "FXMQ20"),
        cell(1, "Fan Coil", "FCU-2", "FXMQ24"),
        { ...cell(1, "Fan Coil", "FCU-1", "24"), parameter: "PE_G___Capacity" },
      ],
      now,
    );
    expect(members).toHaveLength(1);
    expect(JSON.parse(members[0]!.content).patch.types).toEqual({
      "FCU-1": { PE_G___Model: "FXMQ20", PE_G___Capacity: 24 },
      "FCU-2": { PE_G___Model: "FXMQ24" },
    });
    expect(members[0]!.cells).toHaveLength(3);
  });
});
