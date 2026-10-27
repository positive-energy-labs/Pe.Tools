import { familyCellKey, type FamilyCellAddress, type FamilyCellState } from "@pe/agent-contracts";
import { describe, expect, it } from "vite-plus/test";

import { editedFamilies, familiesGroupOf } from "./staged.ts";

const entry = (
  familyName: string,
  typeName: string,
  value: string,
  parameter = "PE_G___Model",
): { address: FamilyCellAddress; cell: FamilyCellState } => ({
  address: { familyName, typeName, parameter },
  cell: {
    suggestion: null,
    edit: {
      value: { value, storageType: parameter === "PE_G___Capacity" ? "Double" : "String" },
    },
  } satisfies FamilyCellState,
});
const cells = (...entries: ReturnType<typeof entry>[]): Record<string, FamilyCellState> =>
  Object.fromEntries(entries.map(({ address, cell }) => [familyCellKey(address), cell]));

describe("edit family cells", () => {
  it("names edited families once, ignoring untaken suggestions", () => {
    const open: ReturnType<typeof entry> = {
      address: { familyName: "Open", typeName: "O-1", parameter: "PE_G___Model" },
      cell: {
        suggestion: { value: { value: "ignored", storageType: "String" } },
        edit: null,
      },
    };
    expect(
      editedFamilies(
        cells(
          entry("Heat Pump", "HP-1", "RXL30"),
          entry("Fan Coil", "FCU-1", "FXMQ20"),
          entry("Fan Coil", "FCU-2", "FXMQ24"),
          open,
        ),
      ),
    ).toEqual(["Fan Coil", "Heat Pump"]);
  });

  it("groups a displayed edit by parameter, family and type", () => {
    const { address } = entry("Fan Coil", "FCU-1", "24", "PE_G___Capacity");
    expect(familiesGroupOf(familyCellKey(address))).toEqual([
      "PE_G___Capacity",
      "Fan Coil",
      "FCU-1",
    ]);
  });
});
