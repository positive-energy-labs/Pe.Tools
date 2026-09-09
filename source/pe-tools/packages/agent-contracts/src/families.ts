import { z } from "zod";

import { routeBindingsSchema, type RouteStateSpec } from "./route-state.ts";
import { readingSchema } from "./reading.ts";

export const diagnosticSchema = z.object({
  code: z.string(),
  path: z.string(),
  message: z.string(),
  suggestion: z.string().nullish(),
});
export const revitDataIssueSchema = z.object({
  code: z.string(),
  severity: z.enum(["Info", "Warning", "Error"]),
  message: z.string(),
  familyName: z.string().nullish(),
  typeName: z.string().nullish(),
  parameterName: z.string().nullish(),
});
const changeSchema = z.object({
  section: z.string(),
  key: z.string(),
  kind: z.string(),
  mappedFrom: z.string().nullish(),
});
export const ffPlanEntrySchema = z.object({
  familyId: z.number(),
  familyName: z.string(),
  planHash: z.string(),
  changes: z.array(changeSchema),
  runEffects: z.array(z.string()),
  refusals: z.array(diagnosticSchema),
  warnings: z.array(revitDataIssueSchema),
});
export type FfPlanEntry = z.infer<typeof ffPlanEntrySchema>;
export const ffReceiptSchema = z.object({
  familyId: z.number(),
  familyName: z.string().nullish(),
  success: z.boolean(),
  converged: z.boolean(),
  error: z.string().nullish(),
  planHash: z.string().nullish(),
  residue: z.array(changeSchema),
  errors: z.array(z.string()),
  artifactDirectory: z.string().nullish(),
});
export type FfReceipt = z.infer<typeof ffReceiptSchema>;

export const familyExecutionOptionsSchema = z
  .object({
    singleTransaction: z.boolean().optional(),
    optimizeTypeOperations: z.boolean().optional(),
    enableCollectors: z.boolean().optional(),
    suppressWarnings: z.boolean().optional(),
  })
  .strict();
export type FamilyExecutionOptions = z.infer<typeof familyExecutionOptionsSchema>;

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
      reading: readingSchema.optional(),
      entries: z.array(ffPlanEntrySchema),
      executionOptions: familyExecutionOptionsSchema.optional(),
    })
    .nullable()
    .default(null),
  excludedIds: z.array(z.number()).default([]),
  apply: z
    .object({
      diagnostics: z.array(diagnosticSchema).default([]),
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
  description: "Family Foundry: plan a native patch against loaded families, exclude, apply.",
  schema: familiesDocumentSchema,
  agentWriteMask: [["excludedIds"], ["profilePath"]],
  commands: {
    plan: {
      description: "Plan the patch against the applied scope; writes plan.",
      input: z.object({
        profilePath: z.string(),
        scope: appliedScopeSchema,
        executionOptions: familyExecutionOptionsSchema.optional(),
        target: z.string().optional(),
      }),
      actor: "any",
      recoversExternal: true,
    },
    apply: {
      description: "HUMAN ONLY. Apply the plan minus exclusions; refuses on plan drift.",
      input: z.object({
        expectedPlanHashes: z.record(z.string(), z.string()),
        target: z.string().optional(),
      }),
      actor: "human",
      mutatesExternal: true,
    },
  },
} satisfies RouteStateSpec<typeof familiesDocumentSchema>;
