import { z } from "zod";
import { nativeResponseSchema } from "@pe/host-contracts/decoders";
import { documentReadTargetSchema } from "./target.ts";
import {
  familiesObservationSchema,
  familiesRouteState,
  familyCellValueSchema,
} from "./families.ts";
import { measuredDisplayUnitSchema } from "./schedule-grid-data.ts";

/** One type's values on the wire. Its family's per-parameter facts travel once, in `facts`. */
export const familyTypeValuesSchema = z.object({
  key: z.string(),
  familyId: z.number(),
  familyName: z.string(),
  categoryName: z.string(),
  typeName: z.string(),
  typeCount: z.number(),
  values: z.record(z.string(), z.string()),
});
/** Per-parameter facts of one family: the same for every one of its types. */
export const familyFactsSchema = z.object({
  scopes: z.record(
    z.string(),
    z.enum(["Unresolved", "Family", "FamilyAndProjectBinding", "ProjectBindingOnly"]),
  ),
  formulas: z.record(z.string(), z.enum(["None", "Present", "NotApplicable", "Unknown"])),
  storageTypes: z.record(z.string(), familyCellValueSchema.shape.storageType.optional()),
  displayUnits: z.record(z.string(), measuredDisplayUnitSchema.nullable()).optional(),
  yesNos: z.record(z.string(), z.boolean()).optional(),
});
export const familyParamColumnSchema = z.object({
  key: z.string(),
  name: z.string(),
  kind: z.enum([
    "Unknown",
    "FamilyParameter",
    "SharedParameter",
    "ProjectParameter",
    "ProjectSharedParameter",
  ]),
  isInstance: z.boolean(),
  isBuiltIn: z.boolean(),
  isProjectOnly: z.boolean(),
  familyCount: z.number(),
  yesNo: z.boolean().optional(),
  displayUnit: measuredDisplayUnitSchema.nullable().optional(),
});
export type TypeRow = z.output<typeof familyTypeValuesSchema> & z.output<typeof familyFactsSchema>;
export type ParamColumn = z.output<typeof familyParamColumnSchema>;
export const familyPivotRowSchema = z.object({
  key: z.string(),
  name: z.string(),
  kind: z.string(),
  families: z.number(),
  filled: z.number(),
  present: z.number(),
  filledByFamily: z.record(z.string(), z.number()),
});
export const familyPivotFamilySchema = z.object({
  familyId: z.number(),
  familyUniqueId: z.string(),
  name: z.string(),
  category: z.string(),
  types: z.number(),
  placed: z.number(),
  params: z.number(),
});
export type PivotRow = z.output<typeof familyPivotRowSchema>;
export type PivotFamily = z.output<typeof familyPivotFamilySchema>;
export const familiesViewArgs = z.object({ target: documentReadTargetSchema });
export const familiesViewData = z.object({
  familiesWork: familiesRouteState.schema,
  /*
   * The value is one reading frame (READING_MAX_FRAME_BYTES): the raw matrix stays on the host,
   * and rows carry only their values (gate-1ebf1fb1: an Air Terminals read encoded to 8.3 MB).
   */
  observation: familiesObservationSchema.omit({ result: true }).nullable(),
  catalog: nativeResponseSchema("revit.catalog.loaded-families"),
  categories: z.array(z.string()),
  outcomes: z.array(
    z.object({ id: z.string(), kind: z.enum(["error", "advisory"]), message: z.string() }),
  ),
  rows: z.array(familyTypeValuesSchema),
  /** Keyed by `familyId`. */
  facts: z.record(z.string(), familyFactsSchema),
  params: z.array(familyParamColumnSchema),
  pivotRows: z.array(familyPivotRowSchema),
  pivotFamilies: z.array(familyPivotFamilySchema),
  activeReadId: z.string().nullable(),
  editRefusal: z.string().nullable(),
});
