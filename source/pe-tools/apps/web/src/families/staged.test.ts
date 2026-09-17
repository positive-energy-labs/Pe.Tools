import { describe, expect, it } from "vite-plus/test";

import { patchValue, revert, stage, stagedMembers } from "./staged.ts";

const at = new Date("2026-09-17T12:00:00.000Z");
const cell = (familyId: number, familyName: string, typeName: string, value: string) => ({
  familyId,
  familyName,
  typeName,
  parameter: "PE_G___Model",
  value,
});

describe("staged cell edits", () => {
  it("stages one value per cell and reverts by address", () => {
    const first = stage([], cell(1, "A", "T1", "x"));
    const second = stage(first, cell(1, "A", "T1", "y"));
    expect(second).toHaveLength(1);
    expect(second[0]!.value).toBe("y");
    // The empty value is the revert: the table never stages "set this cell to nothing".
    expect(stage(second, cell(1, "A", "T1", ""))).toEqual([]);
    expect(revert(second, cell(1, "A", "T1", "y"))).toEqual([]);
    expect(revert(second, cell(2, "B", "T1", "y"))).toHaveLength(1);
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
      at,
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
      at,
    );
    expect(members).toHaveLength(1);
    expect(JSON.parse(members[0]!.content).patch.types).toEqual({
      "FCU-1": { PE_G___Model: "FXMQ20", PE_G___Capacity: 24 },
      "FCU-2": { PE_G___Model: "FXMQ24" },
    });
    expect(members[0]!.cells).toHaveLength(3);
  });
});
