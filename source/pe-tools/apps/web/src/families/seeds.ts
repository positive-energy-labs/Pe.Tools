/**
 * The Families demo world. Everything here is fixture: three loaded families, one spec member in
 * the demo pod, and the plan `families.confirm` would return for that spec over that scope. `?demo=<action>` mounts one seed
 * through `useRoute`; the matrix rows are handed to the workspace because the matrix is a host
 * query, not a Reading a seed can carry.
 */
import {
  familiesRouteState,
  type FamiliesRouteDocument,
  type FfPlanEntry,
  type Seed,
} from "@pe/agent-contracts";

import type { FamilySnapshotRecord, FamilyParameterSnapshot } from "#/host/loaded-families-view";
import { ffPlanRow } from "#/host/familyfoundry";
import type { EntityPage, EntityReading } from "#/route";
import type { DemoSpec } from "#/route/spec-editor";
import { DEMO_FAMILIES_SPEC_PATH, DEMO_PODS } from "#/route/seeds";

import type { FamiliesPage, FamiliesReadingKey } from "./manifest";

const POD = DEMO_PODS[0]!;
const TARGET = { session: "demo", openId: "demo-project" };

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

const entry = (
  familyId: number,
  familyName: string,
  changes: number,
  refusals: FfPlanEntry["refusals"] = [],
): FfPlanEntry => ({
  familyId,
  familyName,
  planHash: `plan-${familyId}`,
  changes: Array.from({ length: changes }, (_, i) => ({
    section: "parameters",
    key: `PE_G___Param${i}`,
    kind: "add",
    mappedFrom: i ? null : "Manufacturer",
  })),
  runEffects: [],
  refusals,
  warnings: [],
});

const work: FamiliesRouteDocument = familiesRouteState.schema.parse({
  scope: { categoryNames: ["Mechanical Equipment"], familyNames: [], placementScope: "AllLoaded" },
  excludedIds: [3102],
});

const plan = [
  entry(3101, "Fan Coil Unit - Ducted", 3),
  entry(3102, "Heat Pump - Split", 1),
  entry(3103, "Air Handler", 0, [
    { code: "FF-MAP-001", path: "$.patch.parameters[0]", message: "no mapping source" },
  ]),
];

type FamiliesSeed = Seed<
  FamiliesRouteDocument,
  FamiliesReadingKey | EntityReading,
  FamiliesPage & Partial<EntityPage>
>;

const seed = (
  title: string,
  page: Partial<EntityPage>,
  readings = {},
  doc: FamiliesRouteDocument = work,
): FamiliesSeed => ({
  title,
  target: { kind: "document", ref: TARGET },
  work: doc,
  readings: {
    receipts: [],
    inventory: { sessions: [] },
    pods: DEMO_PODS,
    ...readings,
  },
  page: { pod: POD.id, ...page } as never,
});

/**
 * The editable table: two cells staged across two families, held as authored Work. Nothing has
 * reached Revit and no file exists yet — plan generates one patch member per family at that moment.
 */
const staged: FamiliesRouteDocument = familiesRouteState.schema.parse({
  scope: { categoryNames: ["Mechanical Equipment"], familyNames: [], placementScope: "AllLoaded" },
  excludedIds: [],
  edits: [
    {
      familyId: 3101,
      familyName: "Fan Coil Unit - Ducted",
      typeName: "FCU-1",
      parameter: "PE_G___Model",
      value: "FXMQ20",
    },
    {
      familyId: 3102,
      familyName: "Heat Pump - Split",
      typeName: "HP-1",
      parameter: "PE_G___Manufacturer",
      value: "Mitsubishi",
    },
  ],
});

/**
 * `?demo=capture` picks two families; `?demo=apply` opens the confirmation sheet on the plan;
 * `?demo=edit` shows the table with staged cell edits waiting for plan.
 */
export const FAMILIES_SEEDS = {
  capture: seed("two families picked for capture into the demo pod", {
    stage: "capture",
    selection: ["3101", "3102"],
  }),
  apply: seed("a saved spec planned over three families, one held back, one refused", {
    stage: "apply",
    path: DEMO_FAMILIES_SPEC_PATH,
    confirming: true,
    sheet: { entries: plan.map(ffPlanRow) },
  }),
  edit: seed(
    "two cells staged across two families; plan generates the spec from them",
    { stage: "apply" },
    {},
    staged,
  ),
};
