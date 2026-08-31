import * as AsyncResult from "effect/unstable/reactivity/AsyncResult";
import * as Atom from "effect/unstable/reactivity/Atom";
import type * as AtomRegistry from "effect/unstable/reactivity/AtomRegistry";
import {
  address,
  applyPatches,
  familiesRouteState,
  type FamiliesRouteDocument,
  type FfPlanEntry,
  type RouteEnvelope,
} from "@pe/agent-contracts";

import type { FamiliesDraft, FamiliesHost } from "#/families/host";
import { createFamiliesStore } from "#/families/store";
import type { FamilyParameterSnapshot, FamilySnapshotRecord } from "#/host/loaded-families-view";

export const fixtureFamiliesAddress = address("C:\\Fixtures\\families-review.rvt");
export const fixtureFamiliesDraft: FamiliesDraft = {
  placement: "AllLoaded",
  categories: ["Air Terminals", "Furniture", "Mechanical Equipment", "Plumbing Fixtures"],
  families: [
    "Desk",
    "VAV Terminal",
    "Fan Coil Unit",
    "Supply Diffuser",
    "Inline Pump",
    "Water Closet",
  ],
};

function planEntry(familyId: number, familyName: string, ...targets: string[]): FfPlanEntry {
  return {
    familyId,
    familyName,
    plan: {
      parameters: [],
      requiredApsParameterNames: [],
      familyParameterNames: [],
      loweredActions: targets.map((target) => ({
        operation: "set",
        target,
        sources: [],
        reason: "profile",
      })),
    },
  };
}

function parameter(
  name: string,
  valuesPerType: Record<string, string | null>,
  options: Partial<Pick<FamilyParameterSnapshot, "kind" | "scope" | "storageType" | "formula">> & {
    identityKind?: FamilyParameterSnapshot["definition"]["identity"]["kind"];
  } = {},
): FamilyParameterSnapshot {
  return {
    definition: {
      identity: { key: name, kind: options.identityKind ?? "NameFallback", name },
      isInstance: false,
    },
    kind: options.kind ?? "FamilyParameter",
    scope: options.scope ?? "Family",
    storageType: options.storageType ?? "String",
    formulaState: options.formula ? "Present" : "None",
    formula: options.formula,
    valuesPerType,
  };
}

export const fixtureFamilyPlanEntry = planEntry(1, "Desk", "Width");

const fixtureFamilyPlanEntries = [
  fixtureFamilyPlanEntry,
  planEntry(101, "VAV Terminal", "Airflow", "PE_Spec Section"),
  planEntry(102, "Fan Coil Unit", "Power", "Manufacturer", "Model"),
  planEntry(103, "Supply Diffuser"),
  planEntry(104, "Inline Pump", "Connection Size", "Power"),
];

export const fixtureFamilyRows: FamilySnapshotRecord[] = [
  {
    familyId: 1,
    familyUniqueId: "fixture-desk",
    familyName: "Desk",
    categoryName: "Furniture",
    typeNames: ["36 inch"],
    parameters: [
      parameter("Type Mark", { "36 inch": "F-01" }, { identityKind: "BuiltInParameter" }),
      parameter("Manufacturer", { "36 inch": "Positive Energy" }),
      parameter("Model", { "36 inch": "Coordination Desk" }),
      parameter("Width", { "36 inch": "3 ft" }, { storageType: "Double" }),
    ],
    issues: [],
    isPartial: false,
    placedInstanceCount: 4,
  },
  {
    familyId: 101,
    familyUniqueId: "fixture-vav-terminal",
    familyName: "VAV Terminal",
    categoryName: "Mechanical Equipment",
    typeNames: ["6 inch", "8 inch", "10 inch"],
    parameters: [
      parameter(
        "Type Mark",
        { "6 inch": "VAV-01", "8 inch": "VAV-02", "10 inch": "VAV-03" },
        { identityKind: "BuiltInParameter" },
      ),
      parameter("Manufacturer", {
        "6 inch": "Acme Air",
        "8 inch": "Acme Air",
        "10 inch": "Acme Air",
      }),
      parameter("Model", { "6 inch": "VAV-6", "8 inch": "VAV-8", "10 inch": "VAV-10" }),
      parameter(
        "Airflow",
        { "6 inch": "350 CFM", "8 inch": "650 CFM", "10 inch": "950 CFM" },
        { storageType: "Double", formula: "Nominal Area * Face Velocity" },
      ),
      parameter(
        "PE_Spec Section",
        { "6 inch": "23 36 16", "8 inch": "23 36 16", "10 inch": "23 36 16" },
        { kind: "ProjectSharedParameter", scope: "ProjectBindingOnly" },
      ),
    ],
    issues: [],
    isPartial: false,
    placedInstanceCount: 18,
  },
  {
    familyId: 102,
    familyUniqueId: "fixture-fan-coil",
    familyName: "Fan Coil Unit",
    categoryName: "Mechanical Equipment",
    typeNames: ["FCU-600", "FCU-900"],
    parameters: [
      parameter(
        "Type Mark",
        { "FCU-600": "FCU-01", "FCU-900": "FCU-02" },
        { identityKind: "BuiltInParameter" },
      ),
      parameter("Manufacturer", { "FCU-600": "Northstar", "FCU-900": "Northstar" }),
      parameter("Model", { "FCU-600": "NS-600", "FCU-900": "NS-900" }),
      parameter(
        "Airflow",
        { "FCU-600": "600 CFM", "FCU-900": "900 CFM" },
        { storageType: "Double" },
      ),
      parameter("Power", { "FCU-600": "0.35 kW", "FCU-900": "0.55 kW" }, { storageType: "Double" }),
      parameter(
        "PE_Spec Section",
        { "FCU-600": "23 82 19", "FCU-900": "23 82 19" },
        { kind: "ProjectSharedParameter", scope: "ProjectBindingOnly" },
      ),
    ],
    issues: [
      {
        code: "MISSING_CONNECTOR_METADATA",
        severity: "Warning",
        message: "Return connection classification is unresolved.",
        familyName: "Fan Coil Unit",
      },
    ],
    isPartial: true,
    placedInstanceCount: 7,
  },
  {
    familyId: 103,
    familyUniqueId: "fixture-supply-diffuser",
    familyName: "Supply Diffuser",
    categoryName: "Air Terminals",
    typeNames: ["12x12", "12x24", "24x24", "Linear 4 ft"],
    parameters: [
      parameter(
        "Type Mark",
        { "12x12": "D-01", "12x24": "D-02", "24x24": "D-03", "Linear 4 ft": "D-04" },
        { identityKind: "BuiltInParameter" },
      ),
      parameter("Manufacturer", {
        "12x12": "Air Pattern",
        "12x24": "Air Pattern",
        "24x24": "Air Pattern",
        "Linear 4 ft": "Air Pattern",
      }),
      parameter("Model", {
        "12x12": "AP-1",
        "12x24": "AP-2",
        "24x24": "AP-4",
        "Linear 4 ft": "AP-L4",
      }),
      parameter(
        "Airflow",
        { "12x12": "150 CFM", "12x24": "250 CFM", "24x24": "500 CFM", "Linear 4 ft": null },
        { storageType: "Double" },
      ),
      parameter(
        "Throw Distance",
        { "12x12": "8 ft", "12x24": "12 ft", "24x24": "16 ft", "Linear 4 ft": "10 ft" },
        { storageType: "Double" },
      ),
    ],
    issues: [
      {
        code: "EMPTY_TYPE_VALUE",
        severity: "Info",
        message: "Linear diffuser airflow has no assigned value.",
        familyName: "Supply Diffuser",
        typeName: "Linear 4 ft",
        parameterName: "Airflow",
      },
    ],
    isPartial: false,
    placedInstanceCount: 42,
  },
  {
    familyId: 104,
    familyUniqueId: "fixture-inline-pump",
    familyName: "Inline Pump",
    categoryName: "Mechanical Equipment",
    typeNames: ["2 inch", "3 inch"],
    parameters: [
      parameter(
        "Type Mark",
        { "2 inch": "P-01", "3 inch": "P-02" },
        { identityKind: "BuiltInParameter" },
      ),
      parameter("Manufacturer", { "2 inch": "Hydronic Works", "3 inch": "Hydronic Works" }),
      parameter("Model", { "2 inch": "IL-2", "3 inch": "IL-3" }),
      parameter("Power", { "2 inch": "1.5 kW", "3 inch": "3.0 kW" }, { storageType: "Double" }),
      parameter(
        "Connection Size",
        { "2 inch": "2 in", "3 inch": "3 in" },
        { storageType: "Double" },
      ),
      parameter(
        "PE_Spec Section",
        { "2 inch": "23 21 23", "3 inch": "23 21 23" },
        { kind: "ProjectSharedParameter", scope: "ProjectBindingOnly" },
      ),
    ],
    issues: [],
    isPartial: false,
    placedInstanceCount: 0,
  },
  {
    familyId: 105,
    familyUniqueId: "fixture-water-closet",
    familyName: "Water Closet",
    categoryName: "Plumbing Fixtures",
    typeNames: ["Floor Mounted", "Wall Hung"],
    parameters: [
      parameter(
        "Type Mark",
        { "Floor Mounted": "P-10", "Wall Hung": "P-11" },
        { identityKind: "BuiltInParameter" },
      ),
      parameter("Manufacturer", { "Floor Mounted": "Clearwater", "Wall Hung": "Clearwater" }),
      parameter("Model", { "Floor Mounted": "CW-F", "Wall Hung": "CW-W" }),
      parameter(
        "Connection Size",
        { "Floor Mounted": "4 in", "Wall Hung": "4 in" },
        { storageType: "Double" },
      ),
      parameter(
        "Flush Volume",
        { "Floor Mounted": "1.28 gpf", "Wall Hung": "1.1 gpf" },
        { storageType: "Double" },
      ),
    ],
    issues: [
      {
        code: "UNPLACED_TYPE",
        severity: "Info",
        message: "Wall Hung is loaded but not placed.",
        familyName: "Water Closet",
        typeName: "Wall Hung",
      },
    ],
    isPartial: false,
    placedInstanceCount: 3,
  },
];

export function createFixtureFamiliesStore(registry: AtomRegistry.AtomRegistry) {
  let envelope: RouteEnvelope<FamiliesRouteDocument> = {
    version: 1,
    revision: 0,
    doc: {
      bindings: {
        world: { id: "session:fixture", label: "fixture", at: fixtureFamiliesAddress },
      },
      profilePath: "desk.json",
      plan: {
        reading: {
          at: fixtureFamiliesAddress,
          version: "fixture-v1",
          observedAt: "2026-08-30T00:00:00Z",
        },
        planHash: "fixture-plan",
        entries: fixtureFamilyPlanEntries,
      },
      excludedIds: [104],
      apply: null,
    },
  };
  const changed = Atom.make(0);
  const slice = Atom.make((get) => {
    get(changed);
    return AsyncResult.success({
      doc: envelope.doc,
      revision: envelope.revision,
      hydrated: true,
      connected: false,
      error: null,
      peaActive: false,
    });
  });
  const host: FamiliesHost = {
    sessions: async () => [
      {
        sessionId: "bridge-fixture",
        sdkSessionId: "fixture",
        processId: 0,
        lane: "dev",
        custody: "controlled",
        activeDocumentId: fixtureFamiliesAddress,
        activeDocumentTitle: "families-review.rvt",
        openDocumentCount: 1,
      },
    ],
    categories: async () => fixtureFamiliesDraft.categories,
    families: async () => fixtureFamiliesDraft.families,
    profiles: async () => ["desk.json"],
    project: async () => ({ projections: [], diagnostics: [] }),
    openPath: async () => {
      throw new Error("fixture path opening is disabled");
    },
  };
  const store = createFamiliesStore({
    registry,
    scope: { documentAddress: fixtureFamiliesAddress },
    host,
    slice,
    writer: {
      apply: async (patches) => {
        const result = applyPatches(
          familiesRouteState,
          envelope,
          "human",
          patches,
          envelope.revision,
        );
        if (!result.ok) return result;
        envelope = result.envelope;
        registry.update(changed, (value) => value + 1);
        return { ok: true, revision: envelope.revision, doc: envelope.doc };
      },
      command: async () => ({
        ok: false,
        kind: "refused",
        error: "fixture family commands are disabled",
        hint: "open /families without source=fixture to use live commands.",
      }),
    },
  });
  return store;
}
