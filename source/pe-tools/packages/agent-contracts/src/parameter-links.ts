import { z } from "zod";

import { parameterIdentitySchema } from "./family-types.ts";
import { defineRouteState, routeBindingSchema } from "./route-state.ts";

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

export const parameterLinksDocumentSchema = z.object({
  binding: routeBindingSchema,
  profile: parameterLinkProfileSchema.nullish().default(null),
  draftProfile: parameterLinkProfileSchema.nullish().default(null),
  evaluation: parameterLinkEvaluationSchema.nullish().default(null),
  status: parameterLinksRuntimeStatusSchema.nullish().default(null),
  profileChanged: z.boolean().default(false),
  appliedWriteCount: z.number().int().default(0),
});
export type ParameterLinksDocument = z.infer<typeof parameterLinksDocumentSchema>;

export const parameterLinksRouteState = defineRouteState({
  route: "parameter-links",
  title: "Parameter Links",
  description: "Review, preview, and reconcile a model-owned parameter linkage profile.",
  key: "route:parameter-links",
  schema: parameterLinksDocumentSchema,
  agentWriteMask: [["draftProfile"]],
  commands: {
    refresh: {
      description:
        "Refresh the stored profile, evaluation, issues, and runtime status from Revit. With multiple Revit sessions connected, pass target (e.g. 'sandbox:<id>' or 'user').",
      input: z.object({ target: z.string().optional() }),
      actor: "any",
      recoversExternal: true,
    },
    preview: {
      description:
        "Evaluate the draft profile without storing it or writing target parameters. With multiple Revit sessions connected, pass target (e.g. 'sandbox:<id>' or 'user').",
      input: z.object({ profile: parameterLinkProfileSchema, target: z.string().optional() }),
      actor: "any",
    },
    apply: {
      description:
        "HUMAN ONLY. Store the draft profile and reconcile its changed target parameter values. With multiple Revit sessions connected, pass target (e.g. 'sandbox:<id>' or 'user').",
      // The dispatcher hands the handler safeParse(...).data; zod strips undeclared keys, so the
      // reviewed profile MUST be declared here or apply always fails its draft-freshness check.
      input: z.object({ profile: parameterLinkProfileSchema, target: z.string().optional() }),
      actor: "human",
      mutatesExternal: true,
    },
  },
});
