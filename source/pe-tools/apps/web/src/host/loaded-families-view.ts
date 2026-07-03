/**
 * Loaded-families boundary, now sourced from C#-authored generated artifacts:
 *   - validation schemas, inferred types, and value constants from `@pe/host-contracts/effect`
 *
 * The generated matrix schema is faithful to the wire (parameters nested under
 * `definition`, `presence` not `scope`, null cells). The table UI wants a flat
 * model, so the one hand-maintained thing here is the flatten adapter: a view
 * mapper, not a contract. If the C# changes, the generated schema/types move
 * and this adapter fails to compile, surfacing drift immediately.
 */
import { loadedFamiliesMatrixDataSchema } from "@pe/host-contracts/effect";
import {
  type LoadedFamilyMatrixFamily as GenMatrixFamily,
  type LoadedFamiliesMatrixData as GenMatrixData,
  type LoadedFamilyExcludedParameterEntry as GenExcludedParameter,
  type LoadedFamilyVisibleParameterEntry as GenVisibleParameter,
  type LoadedFamiliesCatalogRequest,
  type LoadedFamiliesMatrixRequest,
  type ParameterIdentity,
} from "@pe/host-contracts/effect";
import { Schema } from "effect";

// Re-exports so the route imports a single boundary module.
export type {
  LoadedFamiliesCatalogData,
  LoadedFamilyCatalogEntry,
  LoadedFamiliesFilter,
} from "@pe/host-contracts/effect";
export type {
  HostProbeData,
  HostSessionSummaryData as SessionSummaryData,
} from "@pe/host-contracts/operation-types";
// Value constants (usable as `.Member`). C# calls it presence; the UI calls it scope.
export {
  ExcludedParameterReason,
  FormulaState,
  LoadedFamilyParameterKind,
  LoadedFamilyParameterPresence as LoadedFamilyParameterScope,
  LoadedFamilyPlacementScope,
  ParameterIdentityKind,
} from "@pe/host-contracts/effect";

export type LoadedFamiliesRequest = LoadedFamiliesCatalogRequest | LoadedFamiliesMatrixRequest;

// ---- flat view model the table components consume -------------------------

export type LoadedFamilyVisibleParameterEntry = {
  identity: ParameterIdentity;
  isInstance: boolean;
  dataTypeId: string;
  dataTypeLabel: string;
  groupTypeId: string;
  groupTypeLabel: string;
  kind: GenVisibleParameter["kind"];
  scope: GenVisibleParameter["presence"];
  storageType: string;
  formulaState: GenVisibleParameter["formulaState"];
  formula: string;
  valuesByType: Record<string, string>;
};

export type LoadedFamilyExcludedParameterEntry = {
  identity: ParameterIdentity;
  isInstance: boolean;
  kind: GenExcludedParameter["kind"];
  scope: GenExcludedParameter["presence"];
  excludedReason: GenExcludedParameter["excludedReason"];
  formulaState: GenExcludedParameter["formulaState"];
  formula: string;
};

export type LoadedFamilyMatrixFamily = {
  familyId: number;
  familyUniqueId: string;
  familyName: string;
  categoryName: string;
  placedInstanceCount: number;
  types: GenMatrixFamily["types"];
  scheduleNames: GenMatrixFamily["scheduleNames"];
  visibleParameters: LoadedFamilyVisibleParameterEntry[];
  excludedParameters: LoadedFamilyExcludedParameterEntry[];
};

export type LoadedFamiliesMatrixView = {
  families: LoadedFamilyMatrixFamily[];
  issues: GenMatrixData["issues"];
};

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
  return flattenMatrixData(Schema.decodeUnknownSync(loadedFamiliesMatrixDataSchema)(raw));
}
