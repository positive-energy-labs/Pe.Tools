/**
 * Loaded-families boundary. Types come from the checked-in host-typegen output
 * (`@pe/host-contracts/generated`) — generated from the live session's op
 * catalog, so the wire is faithful by construction: parameter fields nest
 * under `definition`, the presence enum lives on `scope`, cell values are
 * `string | null` (null = no value, "" = empty string). This module only adds
 * local aliases and tiny pure helpers (visible filtering and render coercion).
 */
import type { RevitMatrixLoadedFamilies } from "@pe/host-contracts/generated";

export type FamilySnapshotRecord = RevitMatrixLoadedFamilies.Res.FamilySnapshotRecord;
export type FamilyParameterSnapshot = RevitMatrixLoadedFamilies.Res.FamilyParameterSnapshot;
