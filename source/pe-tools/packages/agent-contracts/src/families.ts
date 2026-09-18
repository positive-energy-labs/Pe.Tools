import { z } from "zod";

import { draftProposals } from "./draft.ts";
import type { RouteStateSpec } from "./route-state.ts";

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

/** What `families.capture` saw, per family, beside the members it filed; a failure files nothing. */
export const familiesCaptureEvidenceSchema = z.object({
  diagnostics: z.array(diagnosticSchema),
  families: z.array(
    z.object({
      familyId: z.number(),
      familyName: z.string().nullish(),
      success: z.boolean(),
      coverage: z.record(z.string(), z.string()).default({}),
      unmodeledCount: z.number().default(0),
      issues: z.array(revitDataIssueSchema).default([]),
      error: z.string().nullish(),
      /** The capture's run folder (`output/<runId>`); its `unmodeled.json` holds the facts. */
      run: z.string().nullish(),
    }),
  ),
});
export type FamiliesCaptureEvidence = z.infer<typeof familiesCaptureEvidenceSchema>;

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
 * One proposed cell value on the `/families` audit: a family type's parameter cell and the value
 * someone proposes for it. Pea and a person write the same shape and are told apart by `by`. It is
 * authored Work, not a result — it survives a reload. The address is a family, a type and the EXACT
 * Revit parameter name, because that is what a Family Foundry patch keys on
 * (`patch.types.<typeName>.<parameter>`).
 */
export const familyCellEditSchema = z.object({
  familyId: z.number(),
  familyName: z.string(),
  typeName: z.string(),
  parameter: z.string(),
  value: z.string(),
  by: z.enum(["pea", "human"]),
});
export type FamilyCellEdit = z.infer<typeof familyCellEditSchema>;

/**
 * The Families route document is authored Work and nothing else. The spec is the page's member
 * (one address, sent as `source`) or, for accepted proposals, the members plan generates from them;
 * plans and receipts are results. This document holds only the scope, the cell proposals and their
 * accepts, and what a human or pea held back.
 */
const familiesDocumentSchema = z.object({
  scope: appliedScopeSchema.nullable().default(null),
  excludedIds: z.array(z.number()).default([]),
  ...draftProposals(familyCellEditSchema),
  executionOptions: familyExecutionOptionsSchema.optional(),
});
export type FamiliesRouteDocument = z.infer<typeof familiesDocumentSchema>;

/** The included plan hashes an apply must reproduce exactly. Server and client share this. */
export const familiesIncluded = (
  plan: { entries: readonly FfPlanEntry[] },
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
  description:
    "Family Foundry: author a scope, propose cell values, accept or deny them, plan a spec member, exclude, apply.",
  schema: familiesDocumentSchema,
  // Pea proposes into `edits` exactly as a person does; `accepted` is human-only, so a proposal
  // reaches a plan only through a person's accept.
  agentWriteMask: [["scope"], ["excludedIds"], ["edits"], ["executionOptions"]],
  // Planning and applying are the `families.plan` and `families.apply` workflows. Neither is
  // a route command, so neither can write into authored Work.
  commands: {},
} satisfies RouteStateSpec<typeof familiesDocumentSchema>;
