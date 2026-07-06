/**
 * Loaded-families boundary. Types come from the checked-in host-typegen output
 * (`@pe/host-contracts/generated`) — generated from the live session's op
 * catalog, so the wire is faithful by construction: parameter fields nest
 * under `definition`, the presence enum lives on `scope`, cell values are
 * `string | null` (null = no value, "" = empty string). This module only adds
 * re-exports and tiny pure helpers (visible/excluded split, render coercion).
 */
import type {
  RevitCatalogLoadedFamilies,
  RevitMatrixLoadedFamilies,
} from "@pe/host-contracts/generated";

export type LoadedFamiliesCatalogRequest = RevitCatalogLoadedFamilies.Req.Request;
export type LoadedFamiliesCatalogData = RevitCatalogLoadedFamilies.Res.Response;
export type LoadedFamiliesMatrixRequest = RevitMatrixLoadedFamilies.Req.Request;
export type LoadedFamiliesMatrixData = RevitMatrixLoadedFamilies.Res.Response;
export type FamilySnapshotRecord = RevitMatrixLoadedFamilies.Res.FamilySnapshotRecord;
export type FamilyParameterSnapshot = RevitMatrixLoadedFamilies.Res.FamilyParameterSnapshot;
export type ExcludedParameterReason = RevitMatrixLoadedFamilies.Res.ExcludedParameterReason;
export type {
  HostProbeData,
  HostSessionSummaryData as SessionSummaryData,
} from "@pe/host-contracts/operation-types";

export type LoadedFamiliesRequest = LoadedFamiliesCatalogRequest | LoadedFamiliesMatrixRequest;

/** Wire enum for filter.placementScope, usable as `.Member` in route code. */
export const LoadedFamilyPlacementScope = {
  AllLoaded: "AllLoaded",
  PlacedOnly: "PlacedOnly",
  UnplacedOnly: "UnplacedOnly",
} as const;
export type LoadedFamilyPlacementScope =
  (typeof LoadedFamilyPlacementScope)[keyof typeof LoadedFamilyPlacementScope];

/** Snapshot parameter that the collector excluded, with the reason narrowed. */
export type ExcludedFamilyParameterSnapshot = FamilyParameterSnapshot & {
  excludedReason: ExcludedParameterReason;
};

/** Parameters the matrix UI renders: excludedReason == null. */
export function visibleParameters(family: FamilySnapshotRecord): FamilyParameterSnapshot[] {
  return (family.parameters ?? []).filter((param) => param.excludedReason == null);
}

/** Parameters the collector dropped: excludedReason != null. */
export function excludedParameters(
  family: FamilySnapshotRecord,
): ExcludedFamilyParameterSnapshot[] {
  return (family.parameters ?? []).filter(
    (param): param is ExcludedFamilyParameterSnapshot => param.excludedReason != null,
  );
}

/** Render coercion for wire cells: null (no value) and "" (empty) both display empty. */
export function cellText(value: string | null | undefined): string {
  return value ?? "";
}

/** Shape a raw matrix payload. The wire is trusted (C# validates); this is a typed view. */
export function decodeMatrixData(raw: unknown): LoadedFamiliesMatrixData {
  return raw as LoadedFamiliesMatrixData;
}
