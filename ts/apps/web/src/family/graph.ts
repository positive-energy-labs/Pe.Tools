// Test-only bridge for the byte-frozen DocLab cells witness. Product mounts route.ts.
import { z } from "zod";
import {
  defineRouteGraph,
  familyDraftRouteState,
  routeStatePatchSchema,
  type RouteGraph,
  type FamilyDraft,
} from "@pe/agent-contracts";
import { field } from "../../../../packages/agent-contracts/src/route-field";
import { workVerb } from "../shell/verbs";
import { familyPageSchema, type FamilyPage } from "./page";
export { familyPageSchema, FAMILY_MODEL_SCHEMA, type FamilyPage } from "./page";
export const familyGraph: RouteGraph<FamilyPage, FamilyDraft> = defineRouteGraph<FamilyPage, FamilyDraft>({
  directory: {
    path: "/family",
    title: "Family",
    label: "Family Foundry",
    category: "Build / audit families",
    icon: "Boxes",
    blurb: "Frozen DocLab witness",
    runtimeNeed: "Test witness; no host reads",
    exposure: "Main",
    aliases: [],
    listed: true,
    satellites: [],
    surfaces: { web: "full", pwa: "full", tray: false },
  },
  key: "family",
  address: "family",
  name: "Family",
  work: familyDraftRouteState.schema,
  subjectField:{kind:"singleton",field:"family",noun:"family",keyKind:"name",roster:"test",detail:"test",pane:"table"},
  fields: {
    stage: field(familyPageSchema.shape.stage, {}),
    pod: field(familyPageSchema.shape.pod, {}),
    path: field(familyPageSchema.shape.path, {}),
    pane: field(familyPageSchema.shape.pane, {}),
    query: field(familyPageSchema.shape.query, {}),
    sort: field(familyPageSchema.shape.sort, {}),
    hidden: field(familyPageSchema.shape.hidden, {}),
    overlay: field(familyPageSchema.shape.overlay, {}),
    drill: field(familyPageSchema.shape.drill, {}),
    inspector: field(familyPageSchema.shape.inspector, {}),
    doc: field(familyPageSchema.shape.doc, {}),
    family: field(familyPageSchema.shape.family, {}),
  },
  cells: [{ segment: "cells", groupOf: (key) => [key], nouns: ["parameter"] }],
  readings: {},
  verbs: {
    edit: workVerb(
      {
        label: "Edit family cells",
        input: z.strictObject({
          patches: z.array(routeStatePatchSchema),
          expectedRevision: z.number().int(),
          refusal: z.string().nullable().default(null),
        }),
      },
      {
        ready: (scope, input) =>
          input.refusal ??
          (scope.snapshot.work?.handle.revision === input.expectedRevision
            ? null
            : "Work changed; edit the current family cells"),
        patches: (_, input) => input.patches,
      },
    ),
  },
  panes: { table: { label: "Family parameters", purpose: "Frozen DocLab witness", draws: [] } },
  layout: { kind: "pane", id: "table" },
  stages: {
    audit: { word: "Auditing", panes: ["table"] },
    history: { word: "History", panes: ["table"] },
  },
});
