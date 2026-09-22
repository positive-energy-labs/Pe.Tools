import { z } from "zod";

export const parameterIdentitySchema = z.object({
  key: z.string(),
  kind: z.string(),
  name: z.string(),
  builtInParameterId: z.number().nullish(),
  sharedGuid: z.string().nullish(),
  parameterElementId: z.number().nullish(),
});
export type ParameterIdentity = z.infer<typeof parameterIdentitySchema>;
import type { RouteStateSpec } from "./route-state.ts";
import { canonicalRouteInput } from "./route-doc.ts";
import { trichotomyCellSchema } from "./trichotomy.ts";

const parameterLinkParameterIdentitySchema = parameterIdentitySchema.extend({
  kind: z.enum(["SharedGuid", "BuiltInParameter", "ParameterElement", "NameFallback"]),
});

export const parameterReferenceSchema = z.object({
  identity: parameterLinkParameterIdentitySchema.nullish(),
  name: z.string().nullish(),
  sharedGuid: z.string().nullish(),
});
export type ParameterReference = z.infer<typeof parameterReferenceSchema>;

export const parameterLinkDefinitionSchema = z.object({
  id: z.string(),
  sourceCategoryId: z.number().int(),
  sourceParameter: parameterReferenceSchema,
  sourceScope: z.enum(["instance", "type", "instanceThenType"]).default("instanceThenType"),
  relationship: z.enum(["sameElement", "electricalEquipmentCircuits"]),
  targetParameter: parameterReferenceSchema,
  targetOverride: z
    .object({
      enabledParameter: parameterReferenceSchema,
      valueParameter: parameterReferenceSchema,
    })
    .nullish(),
  reducer: z.enum(["first", "min", "max"]).default("first"),
});
export type ParameterLinkDefinition = z.infer<typeof parameterLinkDefinitionSchema>;

export const parameterLinkAssignmentSchema = z.object({
  id: z.string(),
  definitionId: z.string(),
  enabled: z.boolean().default(true),
  sourceElementUniqueIds: z.array(z.string()).default([]),
});
export type ParameterLinkAssignment = z.infer<typeof parameterLinkAssignmentSchema>;

export const parameterLinkProfileSchema = z.object({
  formatVersion: z.number().int().default(1),
  definitions: z.array(parameterLinkDefinitionSchema).min(1),
  assignments: z.array(parameterLinkAssignmentSchema).default([]),
});
export type ParameterLinkProfile = z.infer<typeof parameterLinkProfileSchema>;

export const parameterLinkValueSchema = z.object({
  storageType: z.string(),
  specTypeId: z.string().nullish(),
  doubleValue: z.number().nullish(),
  integerValue: z.number().int().nullish(),
  stringValue: z.string().nullish(),
  elementIdValue: z.number().int().nullish(),
  displayValue: z.string().nullish(),
});
export type ParameterLinkValue = z.infer<typeof parameterLinkValueSchema>;

export const parameterLinkWriteSchema = z.object({
  definitionId: z.string(),
  assignmentId: z.string(),
  targetElementId: z.number().int(),
  targetElementUniqueId: z.string(),
  targetElementName: z.string().nullish(),
  targetParameter: parameterLinkParameterIdentitySchema,
  currentValue: parameterLinkValueSchema,
  linkedValue: parameterLinkValueSchema,
  overrideValue: parameterLinkValueSchema.nullish(),
  overrideApplied: z.boolean(),
  proposedValue: parameterLinkValueSchema,
  changed: z.boolean(),
});
export type ParameterLinkWrite = z.infer<typeof parameterLinkWriteSchema>;

export const parameterLinkIssueSchema = z.object({
  code: z.string(),
  severity: z.enum(["warning", "error"]),
  message: z.string(),
  definitionId: z.string().nullish(),
  assignmentId: z.string().nullish(),
  sourceElementUniqueId: z.string().nullish(),
  targetElementUniqueId: z.string().nullish(),
});
export type ParameterLinkIssue = z.infer<typeof parameterLinkIssueSchema>;

export const parameterLinkEvaluationSchema = z.object({
  writes: z.array(parameterLinkWriteSchema).default([]),
  issues: z.array(parameterLinkIssueSchema).default([]),
  sourceElementCount: z.number().int().default(0),
  targetElementCount: z.number().int().default(0),
  changedWriteCount: z.number().int().default(0),
});
export type ParameterLinkEvaluation = z.infer<typeof parameterLinkEvaluationSchema>;

export const parameterLinksRuntimeStatusSchema = z.object({
  hasStoredProfile: z.boolean(),
  updaterRegistered: z.boolean(),
  activeDefinitionCount: z.number().int(),
  activeAssignmentCount: z.number().int(),
});
export type ParameterLinksRuntimeStatus = z.infer<typeof parameterLinksRuntimeStatusSchema>;

export const parameterLinksDataSchema = z.object({
  profile: parameterLinkProfileSchema.nullish(),
  evaluation: parameterLinkEvaluationSchema.nullish(),
  status: parameterLinksRuntimeStatusSchema,
  profileChanged: z.boolean(),
  appliedWriteCount: z.number().int(),
});
export type ParameterLinksData = z.infer<typeof parameterLinksDataSchema>;

/**
 * The Parameter Links document is one authored cell: Pea may propose a profile, a person stages
 * it, and evaluate/apply consume the staged profile only. Strict, so the old `{ draft }` shape
 * fails closed rather than lose its value.
 */
export const parameterLinksDocumentSchema = z.strictObject({
  profile: trichotomyCellSchema(parameterLinkProfileSchema).default({}),
});
export type ParameterLinksDocument = z.infer<typeof parameterLinksDocumentSchema>;

/** The profile apply would reconcile: the person's staged value, or none. */
export const stagedParameterProfile = (work: ParameterLinksDocument): ParameterLinkProfile | null =>
  work.profile.staged?.value ?? null;

/**
 * The exact profile an observation was taken against. Identical on the client and the server.
 * A proposal preview names the proposal, so it can never equal a staged basis and arm apply.
 */
export const parameterLinksBasis = (
  work: ParameterLinksDocument,
  subject: "staged" | "proposal" = "staged",
): string =>
  subject === "staged"
    ? canonicalRouteInput(stagedParameterProfile(work))
    : `proposal:${canonicalRouteInput(work.profile.proposal?.value ?? null)}`;

/** A host reading, stored by the capture owner: what Revit holds and what the draft would do. */
export const parameterLinksReadingSchema = z.object({
  basis: z.string().min(1),
  workRevision: z.number().int().nonnegative(),
  /** `stored` observes Revit; `evaluation` observes the profile named by `basis`. */
  evaluated: z.boolean(),
  /** What was evaluated: the staged profile, or a labelled preview of Pea's proposal. */
  subject: z.enum(["staged", "proposal"]).default("staged"),
  stored: parameterLinkProfileSchema.nullish().default(null),
  status: parameterLinksRuntimeStatusSchema,
  evaluation: parameterLinkEvaluationSchema.nullish().default(null),
  profileChanged: z.boolean(),
  appliedWriteCount: z.number().int(),
});
export type ParameterLinksReading = z.infer<typeof parameterLinksReadingSchema>;

export const parameterLinksRouteState = {
  route: "parameter-links",
  title: "Parameter Links",
  description:
    "A person stages a model-owned parameter linkage profile, evaluates it, and reconciles it. Pea may propose a profile; its preview is labelled and never arms apply.",
  schema: parameterLinksDocumentSchema,
  // Pea proposes; the staged profile is a person's, and it is what evaluate and apply consume.
  agentWriteMask: [["profile", "proposal"]],
  // Reading and applying are host ports, not route commands: an observation of Revit can
  // never be written into the draft a human is editing.
  commands: {},
} satisfies RouteStateSpec<typeof parameterLinksDocumentSchema>;
