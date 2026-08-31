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
import type { FamilySnapshotRecord } from "#/host/loaded-families-view";

export const fixtureFamiliesAddress = address("C:\\Fixtures\\families-review.rvt");
export const fixtureFamiliesDraft: FamiliesDraft = {
  placement: "AllLoaded",
  categories: ["Furniture"],
  families: ["Desk"],
};

export const fixtureFamilyPlanEntry: FfPlanEntry = {
  familyId: 1,
  familyName: "Desk",
  plan: {
    parameters: [],
    requiredApsParameterNames: [],
    familyParameterNames: [],
    loweredActions: [{ operation: "set", target: "Width", sources: [], reason: "profile" }],
  },
};

export const fixtureFamilyRows: FamilySnapshotRecord[] = [
  {
    familyId: 1,
    familyUniqueId: "fixture-desk",
    familyName: "Desk",
    categoryName: "Furniture",
    typeNames: ["36 inch"],
    parameters: [
      {
        definition: {
          identity: { key: "Width", kind: "NameFallback", name: "Width" },
          isInstance: false,
        },
        kind: "FamilyParameter",
        scope: "Family",
        storageType: "Double",
        formulaState: "None",
        valuesPerType: { "36 inch": "3 ft" },
      },
    ],
    issues: [],
    isPartial: false,
    placedInstanceCount: 4,
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
        entries: [fixtureFamilyPlanEntry],
      },
      excludedIds: [],
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
