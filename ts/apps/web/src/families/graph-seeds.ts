import {
  bindWork,
  familiesRouteState,
  type GraphSeed,
  type FamiliesRouteDocument,
} from "@pe/agent-contracts";
import { DEMO_FAMILIES } from "./seeds";
import { DEMO_PODS } from "#/route/seeds";
import type { FamiliesPage } from "./graph";

const filter = {
  categoryNames: ["Mechanical Equipment"],
  familyNames: [],
  placementScope: "AllLoaded" as const,
};
const reading = {
  id: "fixture:families",
  work: bindWork("families", null),
  document: { session: "fixture", openId: "families" },
  filter,
  capturedAt: "2026-10-30T00:00:00Z",
  completedAt: "2026-10-30T00:00:00Z",
  result: { families: DEMO_FAMILIES, issues: [], page: null },
};
const seed: GraphSeed<FamiliesPage, FamiliesRouteDocument> = {
  title: "Loaded family matrix",
  work: familiesRouteState.schema.parse({ scope: { edit: { value: filter } } }),
  readings: {
    matrix: reading,
    categories: filter.categoryNames,
    catalog: DEMO_FAMILIES,
    receipts: [],
    archive: [],
    saved: null,
    pods: DEMO_PODS,
  },
  queries: { "families.read": reading, "families.cancel-read": {} },
};
export const familiesSeeds = {
  audit: seed,
  apply: { ...seed, title: "Plan family changes", page: { stage: "apply" as const } },
};
