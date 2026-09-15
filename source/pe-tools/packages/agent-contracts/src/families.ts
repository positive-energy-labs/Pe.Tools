import { z } from "zod";

import type { RouteStateSpec } from "./route-state.ts";
import { canonicalRouteInput } from "./route-doc.ts";
import { observationSchema } from "./reading.ts";

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
export type AppliedFilter = z.infer<typeof appliedScopeSchema>;

/**
 * The Families route document is authored Work and nothing else. Native plans, receipts and
 * every other host reading live with the host owners that produce them; this document holds
 * only what a human or pea typed.
 */
const familiesDocumentSchema = z.object({
  profilePath: z.string().nullable().default(null),
  scope: appliedScopeSchema.nullable().default(null),
  excludedIds: z.array(z.number()).default([]),
  executionOptions: familyExecutionOptionsSchema.optional(),
});
export type FamiliesRouteDocument = z.infer<typeof familiesDocumentSchema>;

/**
 * The exact authored basis a plan was read against. Exclusions are deliberately excluded:
 * excluding a family narrows an existing plan, it does not invalidate the native reading.
 */
export const familiesBasis = (work: FamiliesRouteDocument): string =>
  canonicalRouteInput({
    profilePath: work.profilePath,
    scope: work.scope,
    executionOptions: work.executionOptions ?? null,
  });

/** A host reading, stored by the capture owner. It never lands in the document above. */
export const familiesPlanReadingSchema = z.object({
  basis: z.string().min(1),
  workRevision: z.number().int().nonnegative(),
  reading: observationSchema,
  fileVersion: z.string().nullable(),
  composedDigest: z.string().min(1),
  entries: z.array(ffPlanEntrySchema),
  executionOptions: familyExecutionOptionsSchema.optional(),
});
export type FamiliesPlanReading = z.infer<typeof familiesPlanReadingSchema>;

/** The included plan hashes an apply must reproduce exactly. Server and client share this. */
export const familiesIncluded = (
  plan: Pick<FamiliesPlanReading, "entries">,
  excludedIds: readonly number[],
): Record<string, string> =>
  Object.fromEntries(
    plan.entries
      .filter(
        (entry) =>
          !excludedIds.includes(entry.familyId) &&
          entry.refusals.length === 0 &&
          (entry.changes.length > 0 || entry.runEffects.length > 0),
      )
      .map((entry) => [String(entry.familyId), entry.planHash]),
  );

export const familiesRouteState = {
  route: "families",
  title: "Families",
  description: "Family Foundry: author a profile and scope, read a native plan, exclude, apply.",
  schema: familiesDocumentSchema,
  agentWriteMask: [["profilePath"], ["scope"], ["excludedIds"], ["executionOptions"]],
  // Reading a plan is `family.plan`-style host read; applying it is the `families.apply`
  // semantic action. Neither is a route command, so neither can write into authored Work.
  commands: {},
} satisfies RouteStateSpec<typeof familiesDocumentSchema>;
