import { familyCellKey, type FamilyCellAddress, type FamilyCellState } from "@pe/agent-contracts";
import { describe, expect, it } from "vite-plus/test";

import { patchValue } from "@pe/agent-contracts";
import { familyCellEntries, stagedDrafts } from "./staged.ts";

const entry = (
  familyName: string,
  typeName: string,
  value: string,
  parameter = "PE_G___Model",
): { address: FamilyCellAddress; cell: FamilyCellState } => ({
  address: { familyName, typeName, parameter },
  cell: {
    proposal: null,
    staged: {
      value: { value, storageType: parameter === "PE_G___Capacity" ? "Double" : "String" },
    },
  } satisfies FamilyCellState,
});
const cells = (...entries: ReturnType<typeof entry>[]): Record<string, FamilyCellState> =>
  Object.fromEntries(entries.map(({ address, cell }) => [familyCellKey(address), cell]));

describe("staged family cells", () => {
  it("reads the full address back and retains proposal plus staged values", () => {
    const address = { familyName: "A", typeName: "T1", parameter: "P" };
    const state: FamilyCellState = {
      proposal: { value: { value: "pea", storageType: "String" } },
      staged: { value: { value: "human", storageType: "String" } },
    };
    const document = { [familyCellKey(address)]: state };
    expect(familyCellEntries(document)[0]).toMatchObject({ ...address, cell: state });
  });

  it("keeps a JSON scalar a scalar and everything else the typed text", () => {
    expect(patchValue("12", "Integer")).toBe(12);
    expect(patchValue("true", "Integer")).toBe(true);
    expect(patchValue("false", "Integer")).toBe(false);
    expect(patchValue("FXMQ20", "Integer")).toBe("FXMQ20");
    expect(patchValue("3' - 6\"", "Double")).toBe("3' - 6\"");
  });

  it("generates one patch draft per family from staged cells only", () => {
    const open: ReturnType<typeof entry> = {
      address: { familyName: "Open", typeName: "O-1", parameter: "PE_G___Model" },
      cell: {
        proposal: { value: { value: "ignored", storageType: "String" } },
        staged: null,
      },
    };
    const members = stagedDrafts(
      cells(entry("Heat Pump", "HP-1", "RXL30"), entry("Fan Coil", "FCU-1", "FXMQ20"), open),
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
        entry("Fan Coil", "FCU-1", "FXMQ20"),
        entry("Fan Coil", "FCU-2", "FXMQ24"),
        entry("Fan Coil", "FCU-1", "24", "PE_G___Capacity"),
      ),
    );
    expect(JSON.parse(members[0]!.content).patch.types).toEqual({
      "FCU-1": { PE_G___Model: "FXMQ20", PE_G___Capacity: 24 },
      "FCU-2": { PE_G___Model: "FXMQ24" },
    });
  });
});
