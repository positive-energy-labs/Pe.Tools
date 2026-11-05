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
import { draftCellSchema } from "./draft.ts";

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
 * Parameter Links Work: one StateCell per authored id (ADR 0030 rules 2 and 8), so a person and Pea
 * staging different definitions never overwrite each other. A cell with no edit shows the model's
 * stored profile; a delete rung removes that id. Strict, so the old `{ draft }` and whole-`profile`
 * shapes fail closed rather than lose their value.
 */
const idCells = <V extends z.ZodType>(value: V) =>
  z.record(z.string().min(1), draftCellSchema(value, { deletable: true })).default({});
export const parameterLinksDocumentSchema = z.strictObject({
  definitions: idCells(parameterLinkDefinitionSchema.omit({ id: true })),
  assignments: idCells(parameterLinkAssignmentSchema.omit({ id: true })),
});
export type ParameterLinksDocument = z.infer<typeof parameterLinksDocumentSchema>;

type IdCells<V> = Record<string, { edit?: { value?: V; delete?: true } | null }>;
/** The model's entries with each staged edit laid over it by id; null when nothing is staged. */
export function overlayCells<V extends object>(
  base: readonly (V & { id: string })[],
  cells: IdCells<V>,
): (V & { id: string })[] | null {
  const staged = Object.entries(cells).filter(([, cell]) => cell.edit);
  if (!staged.length) return null;
  const byId = new Map(base.map((entry) => [entry.id, entry]));
  for (const [id, { edit }] of staged)
    if (edit!.delete) byId.delete(id);
    else byId.set(id, { ...edit!.value!, id });
  return [...byId.values()];
}

/** The profile apply would reconcile: the stored profile with staged cells laid over it, or none. */
export function stagedParameterProfile(
  work: ParameterLinksDocument,
  stored: ParameterLinkProfile | null,
): ParameterLinkProfile | null {
  const definitions = overlayCells(stored?.definitions ?? [], work.definitions);
  const assignments = overlayCells(stored?.assignments ?? [], work.assignments);
  if (!definitions && !assignments) return null;
  return parameterLinkProfileSchema.parse({
    formatVersion: stored?.formatVersion ?? 1,
    definitions: definitions ?? stored?.definitions ?? [],
    assignments: assignments ?? stored?.assignments ?? [],
  });
}

/**
 * The exact profile an observation was taken against. Identical on the client and the server.
 */
export const parameterLinksBasis = (
  work: ParameterLinksDocument,
  stored: ParameterLinkProfile | null,
): string => canonicalRouteInput(stagedParameterProfile(work, stored));

/** A host reading, stored by the capture owner: what Revit holds and what the draft would do. */
export const parameterLinksReadingSchema = z.object({
  basis: z.string().min(1),
  workRevision: z.number().int().nonnegative(),
  /** `stored` observes Revit; `evaluation` observes the profile named by `basis`. */
  evaluated: z.boolean(),
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
    "Either author stages definitions and assignments of the model-owned parameter linkage profile by id, evaluates them, and reconciles them through the host.",
  schema: parameterLinksDocumentSchema,
  // Evaluate and Apply consume every staged cell, each whoever wrote it last.
  // Reading and applying are host ports, not route commands: an observation of Revit can
  // never be written into authored Work.
} satisfies RouteStateSpec<typeof parameterLinksDocumentSchema>;
