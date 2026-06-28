/**
 * Loaded-families boundary, now sourced from C#-authored generated artifacts:
 *   - validation schemas from `@pe/host-generated/zod` (reflected from C#)
 *   - value enums from `@pe/host-generated/types` (TypeGen interfaces/enums)
 *
 * The generated matrix schema is faithful to the wire (parameters nested under
 * `definition`, `presence` not `scope`, null cells). The table UI wants a flat
 * model, so the ONE hand-maintained thing here is the flatten adapter — a view
 * mapper, not a contract. If the C# changes, the generated schema/types move
 * and this adapter fails to compile, surfacing drift immediately.
 */
import {
  type LoadedFamilyMatrixFamily as GenMatrixFamily,
  type LoadedFamiliesMatrixData as GenMatrixData,
  type LoadedFamiliesFilter,
  type ParameterIdentity,
  type RevitDataOutputBudget,
  loadedFamiliesMatrixDataSchema,
} from "@pe/host-generated/zod";
import type {
  ExcludedParameterReason,
  FormulaState,
  LoadedFamilyParameterKind,
  LoadedFamilyParameterPresence,
} from "@pe/host-generated/types";

// Re-exports so the route imports a single boundary module.
export {
  hostProbeDataSchema,
  hostSessionSummaryDataSchema as sessionSummaryDataSchema,
  loadedFamiliesCatalogDataSchema,
} from "@pe/host-generated/zod";
export type {
  HostProbeData,
  HostSessionSummaryData as SessionSummaryData,
  LoadedFamiliesCatalogData,
  LoadedFamilyCatalogEntry,
  LoadedFamiliesFilter,
} from "@pe/host-generated/zod";
// Value enums (usable as `.Member`). C# calls it presence; the UI calls it scope.
export {
  ExcludedParameterReason,
  FormulaState,
  LoadedFamilyParameterKind,
  LoadedFamilyParameterPresence as LoadedFamilyParameterScope,
  LoadedFamilyPlacementScope,
  ParameterIdentityKind,
} from "@pe/host-generated/types";

export interface LoadedFamiliesRequest {
  filter?: LoadedFamiliesFilter;
  budget?: RevitDataOutputBudget;
}

// ---- flat view model the table components consume -------------------------

export interface LoadedFamilyVisibleParameterEntry {
  identity: ParameterIdentity;
  isInstance: boolean;
  dataTypeId: string;
  dataTypeLabel: string;
  groupTypeId: string;
  groupTypeLabel: string;
  kind: LoadedFamilyParameterKind;
  scope: LoadedFamilyParameterPresence;
  storageType: string;
  formulaState: FormulaState;
  formula: string;
  valuesByType: Record<string, string>;
}

export interface LoadedFamilyExcludedParameterEntry {
  identity: ParameterIdentity;
  isInstance: boolean;
  kind: LoadedFamilyParameterKind;
  scope: LoadedFamilyParameterPresence;
  excludedReason: ExcludedParameterReason;
  formulaState: FormulaState;
  formula: string;
}

export interface LoadedFamilyMatrixFamily {
  familyId: number;
  familyUniqueId: string;
  familyName: string;
  categoryName: string;
  placedInstanceCount: number;
  types: Array<{ typeName: string }>;
  scheduleNames: string[];
  visibleParameters: LoadedFamilyVisibleParameterEntry[];
  excludedParameters: LoadedFamilyExcludedParameterEntry[];
}

export interface LoadedFamiliesMatrixView {
  families: LoadedFamilyMatrixFamily[];
  issues: GenMatrixData["issues"];
}

function flattenValues(values: Record<string, string | null>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(values)) out[key] = value ?? "";
  return out;
}

function flattenFamily(family: GenMatrixFamily): LoadedFamilyMatrixFamily {
  return {
    familyId: family.familyId,
    familyUniqueId: family.familyUniqueId,
    familyName: family.familyName,
    categoryName: family.categoryName ?? "",
    placedInstanceCount: family.placedInstanceCount,
    types: family.types,
    scheduleNames: family.scheduleNames,
    visibleParameters: family.visibleParameters.map((p) => ({
      identity: p.definition.identity,
      isInstance: p.definition.isInstance ?? false,
      dataTypeId: p.definition.dataTypeId ?? "",
      dataTypeLabel: p.definition.dataTypeLabel ?? "",
      groupTypeId: p.definition.groupTypeId ?? "",
      groupTypeLabel: p.definition.groupTypeLabel ?? "",
      kind: p.kind,
      scope: p.presence,
      storageType: p.storageType,
      formulaState: p.formulaState,
      formula: p.formula ?? "",
      valuesByType: flattenValues(p.valuesByType),
    })),
    excludedParameters: family.excludedParameters.map((p) => ({
      identity: p.definition.identity,
      isInstance: p.definition.isInstance ?? false,
      kind: p.kind,
      scope: p.presence,
      excludedReason: p.excludedReason,
      formulaState: p.formulaState,
      formula: p.formula ?? "",
    })),
  };
}

/** Map a validated matrix payload into the flat table view. */
export function flattenMatrixData(data: GenMatrixData): LoadedFamiliesMatrixView {
  return { families: data.families.map(flattenFamily), issues: data.issues };
}

/** Parse a raw matrix payload (generated schema) then flatten. Used by tests. */
export function flattenMatrix(raw: unknown): LoadedFamiliesMatrixView {
  return flattenMatrixData(loadedFamiliesMatrixDataSchema.parse(raw));
}

export { loadedFamiliesMatrixDataSchema };
