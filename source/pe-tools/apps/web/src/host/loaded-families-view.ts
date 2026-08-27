/**
 * Loaded-families boundary. Types come from the checked-in host-typegen output
 * (`@pe/host-contracts/generated`) — generated from the live session's op
 * catalog, so the wire is faithful by construction: parameter fields nest
 * under `definition`, the presence enum lives on `scope`, cell values are
 * `string | null` (null = no value, "" = empty string). This module only adds
 * local aliases and tiny pure helpers (visible filtering and render coercion).
 */
import type { RevitMatrixLoadedFamilies } from "@pe/host-contracts/generated";

export type LoadedFamiliesMatrixRequest = RevitMatrixLoadedFamilies.Req.Request;
export type FamilySnapshotRecord = RevitMatrixLoadedFamilies.Res.FamilySnapshotRecord;
export type FamilyParameterSnapshot = RevitMatrixLoadedFamilies.Res.FamilyParameterSnapshot;

/** Wire enum for filter.placementScope, usable as `.Member` in route code. */
export const LoadedFamilyPlacementScope = {
  AllLoaded: "AllLoaded",
  PlacedOnly: "PlacedOnly",
  UnplacedOnly: "UnplacedOnly",
} as const;
export type LoadedFamilyPlacementScope =
  (typeof LoadedFamilyPlacementScope)[keyof typeof LoadedFamilyPlacementScope];

/** Parameters the matrix UI renders: excludedReason == null. */
export function visibleParameters(family: FamilySnapshotRecord): FamilyParameterSnapshot[] {
  return (family.parameters ?? []).filter((param) => param.excludedReason == null);
}

/** Render coercion for wire cells: null (no value) and "" (empty) both display empty. */
export function cellText(value: string | null | undefined): string {
  return value ?? "";
}
