import type { FamilySnapshotRecord, FamilyParameterSnapshot } from "#/host/loaded-families-view";
import type { DemoSpec } from "#/route/seeds";
const param = (name: string, values: Record<string, string | null>): FamilyParameterSnapshot => ({
  definition: {
    identity: { key: `name:${name}`, kind: "NameFallback", name },
    isInstance: false,
  },
  kind: "FamilyParameter",
  scope: "Family",
  storageType: "String",
  formulaState: "None",
  valuesPerType: values,
});

const family = (
  familyId: number,
  familyName: string,
  types: Record<string, string>,
): FamilySnapshotRecord => ({
  familyId,
  familyUniqueId: `demo-${familyId}`,
  familyName,
  categoryName: "Mechanical Equipment",
  typeNames: Object.keys(types),
  parameters: [
    param("PE_G___Manufacturer", Object.fromEntries(Object.keys(types).map((t) => [t, "Daikin"]))),
    param("PE_G___Model", types),
  ],
  issues: [],
  isPartial: false,
  placedInstanceCount: 2,
});

export const DEMO_FAMILIES: readonly FamilySnapshotRecord[] = [
  family(3101, "Fan Coil Unit - Ducted", { "FCU-1": "FXMQ15", "FCU-2": "FXMQ24" }),
  family(3102, "Heat Pump - Split", { "HP-1": "RXL24" }),
  family(3103, "Air Handler", { "AHU-1": "AHU-10" }),
];

/** The demo spec's bytes. No schema is seeded, so the editor shows it raw. */
export const DEMO_FAMILIES_SPEC: DemoSpec = {
  content: JSON.stringify(
    {
      $schema: "http://localhost:5150/schemas/settings/FamilyFoundry/patches.json",
      select: { categoryNames: ["Mechanical Equipment"] },
      patch: { parameters: [{ name: "PE_G___Manufacturer", mapFrom: "Manufacturer" }] },
      run: { singleTransaction: true },
    },
    null,
    2,
  ),
  schema: "",
};
