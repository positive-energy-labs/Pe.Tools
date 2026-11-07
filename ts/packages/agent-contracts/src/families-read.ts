import { z } from "zod";
import { nativeResponseSchema } from "@pe/host-contracts/decoders";
import { documentRefSchema } from "./target.ts";
import { familiesObservationSchema, familiesRouteState, familyCellValueSchema } from "./families.ts";
import { measuredDisplayUnitSchema } from "./schedule-grid-data.ts";
import { actionReceiptListDecoder } from "./action-receipts.ts";
import { publicationRequest, publicationSchema } from "./value.ts";


export const familyTypeRowSchema = z.object({
  key: z.string(), familyId: z.number(), familyName: z.string(), categoryName: z.string(),
  typeName: z.string(), typeCount: z.number(), values: z.record(z.string(), z.string()),
  scopes: z.record(z.string(), z.enum(["Unresolved","Family","FamilyAndProjectBinding","ProjectBindingOnly"])),
  formulas: z.record(z.string(), z.enum(["None","Present","NotApplicable","Unknown"])),
  storageTypes: z.record(z.string(), familyCellValueSchema.shape.storageType.optional()),
  displayUnits: z.record(z.string(), measuredDisplayUnitSchema.nullable()).optional(),
  yesNos: z.record(z.string(), z.boolean()).optional(),
});
export const familyParamColumnSchema = z.object({
  key: z.string(), name: z.string(), kind: z.enum(["Unknown","FamilyParameter","SharedParameter","ProjectParameter","ProjectSharedParameter"]),
  isInstance: z.boolean(), isBuiltIn: z.boolean(), isProjectOnly: z.boolean(), familyCount: z.number(),
  yesNo: z.boolean().optional(), displayUnit: measuredDisplayUnitSchema.nullable().optional(),
});
export type TypeRow = z.output<typeof familyTypeRowSchema>;
export type ParamColumn = z.output<typeof familyParamColumnSchema>;
export const familyPivotRowSchema = z.object({
  key: z.string(), name: z.string(), kind: z.string(), families: z.number(), filled: z.number(), present: z.number(),
  filledByFamily: z.record(z.string(), z.number()), typesByFamily: z.record(z.string(), z.array(familyTypeRowSchema)),
});
export const familyPivotFamilySchema = z.object({
  familyId: z.number(), familyUniqueId: z.string(), name: z.string(), category: z.string(),
  types: z.number(), placed: z.number(), params: z.number(),
});
export type PivotRow = z.output<typeof familyPivotRowSchema>;
export type PivotFamily = z.output<typeof familyPivotFamilySchema>;
export const familiesViewArgs = z.object({ target: documentRefSchema });
export const familiesViewData = z.object({
  familiesWork: familiesRouteState.schema,
  observation: familiesObservationSchema.nullable(),
  catalog: nativeResponseSchema("revit.catalog.loaded-families"),
  categories: z.array(z.string()),
  receipts: actionReceiptListDecoder(),
  rows: z.array(familyTypeRowSchema), params: z.array(familyParamColumnSchema),
  pivotRows: z.array(familyPivotRowSchema), pivotFamilies: z.array(familyPivotFamilySchema),
  editRefusal: z.string().nullable(),
});
export const familiesViewRequest = publicationRequest(familiesViewArgs);
export const familiesViewCapability = {
  key: "families.view" as const,
  input: familiesViewArgs.omit({target:true}), output: publicationSchema(familiesViewData),
  axes: {subject:"Document", touches:["Metadata"], effect:"Read", cost:"Cheap", cardinality:"One"} as const,
};
