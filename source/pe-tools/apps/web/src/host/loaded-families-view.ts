/**
 * Loaded-families boundary, sourced from C#-authored generated artifacts:
 *   - validation schemas, inferred types, and value constants from `@pe/host-contracts/effect`
 *
 * Components consume the canonical `FamilySnapshotRecord` directly — there is
 * no hand-maintained view model. The wire is faithful: parameter fields nest
 * under `definition`, the presence enum lives on `scope`, cell values are
 * `string | null` (null = no value, "" = empty string). This module only adds
 * re-exports and tiny pure helpers (visible/excluded split, render coercion).
 */
import {
  type ExcludedParameterReason as ExcludedParameterReasonType,
  type FamilyParameterSnapshot,
  type FamilySnapshotRecord,
  type LoadedFamiliesCatalogRequest,
  type LoadedFamiliesMatrixData,
  type LoadedFamiliesMatrixRequest,
  loadedFamiliesMatrixDataSchema,
} from "@pe/host-contracts/effect";
import { Schema } from "effect";

// Re-exports so the routes import a single boundary module.
export type {
  FamilyParameterSnapshot,
  FamilySnapshotRecord,
  LoadedFamiliesCatalogData,
  LoadedFamiliesCatalogRequest,
  LoadedFamiliesFilter,
  LoadedFamiliesMatrixData,
  LoadedFamiliesMatrixRequest,
  LoadedFamilyCatalogEntry,
  ParameterDefinitionDescriptor,
  ParameterIdentity,
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

/** Snapshot parameter that the collector excluded, with the reason narrowed. */
export type ExcludedFamilyParameterSnapshot = FamilyParameterSnapshot & {
  excludedReason: ExcludedParameterReasonType;
};

/** Parameters the matrix UI renders: excludedReason == null. */
export function visibleParameters(family: FamilySnapshotRecord): FamilyParameterSnapshot[] {
  return family.parameters.filter((param) => param.excludedReason == null);
}

/** Parameters the collector dropped: excludedReason != null. */
export function excludedParameters(
  family: FamilySnapshotRecord,
): ExcludedFamilyParameterSnapshot[] {
  return family.parameters.filter(
    (param): param is ExcludedFamilyParameterSnapshot => param.excludedReason != null,
  );
}

/** Render coercion for wire cells: null (no value) and "" (empty) both display empty. */
export function cellText(value: string | null | undefined): string {
  return value ?? "";
}

/** Parse a raw matrix payload against the generated wire schema. Used by tests. */
export function decodeMatrixData(raw: unknown): LoadedFamiliesMatrixData {
  return Schema.decodeUnknownSync(loadedFamiliesMatrixDataSchema)(raw);
}
