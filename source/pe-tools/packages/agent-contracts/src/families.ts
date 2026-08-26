import { z } from "zod";

import { parameterIdentitySchema } from "./family-types.ts";
import { routeBindingsSchema, type RouteStateSpec } from "./route-state.ts";
import { readingSchema } from "./reading.ts";

const resolvedParameterSchema = z.object({
  definition: z.object({
    identity: parameterIdentitySchema,
    name: z.string(),
    dataTypeId: z.string(),
    propertiesGroupId: z.string(),
    isInstance: z.boolean(),
    tooltip: z.string().nullish(),
  }),
  isShared: z.boolean(),
  assignment: z.object({ kind: z.string(), value: z.string() }).nullish(),
  valuesByType: z.record(z.string(), z.string().nullable()),
  migration: z
    .object({
      sourceNames: z.array(z.string()),
      onlyAddIfSourceExists: z.boolean(),
      mappingStrategy: z.string(),
    })
    .nullish(),
  provenance: z.object({
    identity: z.string(),
    dataType: z.string(),
    propertiesGroup: z.string(),
    isInstance: z.string(),
    tooltip: z.string(),
  }),
});

const ffPlanEntrySchema = z.object({
  familyId: z.number(),
  familyName: z.string(),
  plan: z.object({
    parameters: z.array(resolvedParameterSchema),
    requiredApsParameterNames: z.array(z.string()),
    familyParameterNames: z.array(z.string()),
    loweredActions: z.array(
      z.object({
        operation: z.string(),
        target: z.string(),
        sources: z.array(z.string()),
        reason: z.string(),
      }),
    ),
  }),
});
export type FfPlanEntry = z.infer<typeof ffPlanEntrySchema>;

const ffReceiptSchema = z.object({
  familyId: z.number(),
  familyName: z.string().nullish(),
  success: z.boolean(),
  error: z.string().nullish(),
  operationsRun: z.array(z.string()),
  parametersChanged: z.number(),
  diffSummary: z.object({ added: z.number(), removed: z.number(), modified: z.number() }),
  artifactDirectoryPath: z.string().nullish(),
});
export type FfReceipt = z.infer<typeof ffReceiptSchema>;

const appliedScopeSchema = z.object({
  categoryNames: z.array(z.string()),
  familyNames: z.array(z.string()),
  placementScope: z.enum(["AllLoaded", "PlacedOnly", "UnplacedOnly"]),
});
export type AppliedScope = z.infer<typeof appliedScopeSchema>;

const familiesDocumentSchema = z.object({
  bindings: routeBindingsSchema,
  profilePath: z.string().nullable().default(null),
  plan: z
    .object({
      reading: readingSchema,
      planHash: z.string(),
      entries: z.array(ffPlanEntrySchema),
    })
    .nullable()
    .default(null),
  excludedIds: z.array(z.number()).default([]),
  apply: z
    .object({
      planHash: z.string(),
      appliedAt: z.string(),
      receipts: z.array(ffReceiptSchema),
      artifacts: z.array(z.string()),
    })
    .nullable()
    .default(null),
});
export type FamiliesRouteDocument = z.infer<typeof familiesDocumentSchema>;

export const familiesRouteState = {
  route: "families",
  title: "Families",
  description: "Family Foundry: plan a profile against loaded families, exclude, apply.",
  schema: familiesDocumentSchema,
  agentWriteMask: [["excludedIds"], ["profilePath"]],
  commands: {
    plan: {
      description: "Compile the profile against the applied scope; writes plan.",
      input: z.object({
        profilePath: z.string(),
        scope: appliedScopeSchema,
        target: z.string().optional(),
      }),
      actor: "any",
    },
    apply: {
      description: "HUMAN ONLY. Apply the plan minus exclusions; refuses on plan drift.",
      input: z.object({
        expectedPlanHash: z.string(),
        target: z.string().optional(),
      }),
      actor: "human",
      mutatesExternal: true,
    },
  },
} satisfies RouteStateSpec<typeof familiesDocumentSchema>;
