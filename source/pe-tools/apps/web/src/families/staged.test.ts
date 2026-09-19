import { familyCellKey, type FamilyCellAddress, type FamilyCellState } from "@pe/agent-contracts";
import { describe, expect, it } from "vite-plus/test";

import { patchValue } from "@pe/agent-contracts";
import { cellAt, familyCellEntries, stagedDrafts } from "./staged.ts";

const entry = (
  familyId: number,
  familyName: string,
  typeName: string,
  value: string,
  parameter = "PE_G___Model",
): { address: FamilyCellAddress; cell: FamilyCellState } => ({
  address: { familyId, typeName, parameter },
  cell: {
    proposal: null,
    staged: { value: { familyName, value } },
  } satisfies FamilyCellState,
});
const cells = (...entries: ReturnType<typeof entry>[]): Record<string, FamilyCellState> =>
  Object.fromEntries(entries.map(({ address, cell }) => [familyCellKey(address), cell]));

describe("staged family cells", () => {
  it("looks up the full address and retains proposal plus staged values", () => {
    const address = { familyId: 1, typeName: "T1", parameter: "P" };
    const state: FamilyCellState = {
      proposal: { value: { familyName: "A", value: "pea" } },
      staged: { value: { familyName: "A", value: "human" } },
    };
    const document = { [familyCellKey(address)]: state };
    expect(cellAt(document, address)).toBe(state);
    expect(familyCellEntries(document)[0]).toMatchObject(address);
  });

  it("keeps a JSON scalar a scalar and everything else the typed text", () => {
    expect(patchValue("12")).toBe(12);
    expect(patchValue("true")).toBe(true);
    expect(patchValue("false")).toBe(false);
    expect(patchValue("FXMQ20")).toBe("FXMQ20");
    expect(patchValue("3' - 6\"")).toBe("3' - 6\"");
  });

  it("generates one patch draft per family from staged cells only", () => {
    const open: ReturnType<typeof entry> = {
      address: { familyId: 3, typeName: "O-1", parameter: "PE_G___Model" },
      cell: {
        proposal: { value: { familyName: "Open", value: "ignored" } },
        staged: null,
      },
    };
    const members = stagedDrafts(
      cells(entry(2, "Heat Pump", "HP-1", "RXL30"), entry(1, "Fan Coil", "FCU-1", "FXMQ20"), open),
      "http://localhost:5150/schemas/settings/FamilyFoundry/patches.json",
    );
    expect(members.map((member) => member.familyName)).toEqual(["Fan Coil", "Heat Pump"]);
    expect(JSON.parse(members[0]!.content)).toEqual({
      $schema: "http://localhost:5150/schemas/settings/FamilyFoundry/patches.json",
      select: { names: ["Fan Coil"] },
      patch: { types: { "FCU-1": { PE_G___Model: "FXMQ20" } } },
    });
  });

  it("collects every staged cell of one family into that family's draft", () => {
    const members = stagedDrafts(
      cells(
        entry(1, "Fan Coil", "FCU-1", "FXMQ20"),
        entry(1, "Fan Coil", "FCU-2", "FXMQ24"),
        entry(1, "Fan Coil", "FCU-1", "24", "PE_G___Capacity"),
      ),
    );
    expect(JSON.parse(members[0]!.content).patch.types).toEqual({
      "FCU-1": { PE_G___Model: "FXMQ20", PE_G___Capacity: 24 },
      "FCU-2": { PE_G___Model: "FXMQ24" },
    });
  });
});
