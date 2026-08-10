/**
 * RHVAC .r10 file access over the five `rhvac.*` host local ops (apps/host/
 * src/rhvac-ops.ts — TS-only ops spawning the repo's 32-bit Jet scripts).
 *
 * Contract (all paths are host-visible, e.g. G:\\projects\\job\\project.r10):
 *   rhvac.open       { path }                          → RhvacExtract
 *   rhvac.assemblies { path }                          → RhvacAssemblyCatalog
 *   rhvac.save       { sourcePath, outputPath, edits } → RhvacSaveResult
 *   rhvac.takeoff    { path }                          → raw TSVs + room map
 *   rhvac.takeoff-resolutions { path, resolutions? }   → sidecar path + contents
 *
 * rhvac.takeoff takes the .r10 FILE path and returns the raw takeoff TSV texts
 * (`<dir>/takeoff/*.tsv`) plus `<dir>/room-map.json` found next to it; parsing
 * stays client-side (parseTakeoffTsv), matching the fixture lane. Missing
 * takeoff data is an empty result, not an error.
 */
import { callHostDynamic } from "#/host/client";
import type { ResolutionsFile } from "#/rhvac/resolutions";
import { mergeTakeoffLevels, parseTakeoffTsv } from "#/rhvac/takeoff";
import type {
  RhvacTakeoffResolutionsRequest,
  RhvacTakeoffResolutionsResult as HostRhvacTakeoffResolutionsResult,
} from "@pe/host-contracts/operation-types";
import {
  normalizeExtract,
  type RhvacAssemblyCatalog,
  type RhvacExtract,
  type RhvacRoom,
  type RhvacTakeoffData,
  type RoomMap,
} from "#/rhvac/types";

export interface RhvacSaveEdits {
  /** Full room objects (including identifier) — the op writes them back whole. */
  updates: RhvacRoom[];
  /** Room identifiers (autonumber PK) to delete. */
  deletes: number[];
}

export interface RhvacSaveArgs {
  sourcePath: string;
  /** Must differ from sourcePath — the original file is never overwritten. */
  outputPath: string;
  edits: RhvacSaveEdits;
}

export interface RhvacSaveResult {
  outputPath: string;
  updated: number;
  deleted: number;
}

export interface RhvacTakeoffArgs {
  /** The .r10 FILE path (the op resolves `<dir>/takeoff/*.tsv` + `<dir>/room-map.json` from it). */
  path: string;
}

/** Wire shape of rhvac.takeoff — raw snapshots; the client parses the TSVs. */
interface RhvacTakeoffWire {
  tsvs: { name: string; text: string; sha256: string }[];
  roomMap: RoomMap | null;
}

export async function rhvacOpen(path: string): Promise<RhvacExtract> {
  const raw = (await callHostDynamic("rhvac.open", { path })) as RhvacExtract;
  return normalizeExtract(raw);
}

export async function rhvacAssemblies(path: string): Promise<RhvacAssemblyCatalog> {
  return (await callHostDynamic("rhvac.assemblies", { path })) as RhvacAssemblyCatalog;
}

export async function rhvacSave(args: RhvacSaveArgs): Promise<RhvacSaveResult> {
  return (await callHostDynamic("rhvac.save", args)) as RhvacSaveResult;
}

export type RhvacTakeoffResolutionsArgs = Required<RhvacTakeoffResolutionsRequest> & {
  resolutions: ResolutionsFile;
};
export type RhvacTakeoffResolutionsResult = HostRhvacTakeoffResolutionsResult;

export async function rhvacLoadTakeoffResolutions(
  path: string,
): Promise<RhvacTakeoffResolutionsResult> {
  return (await callHostDynamic("rhvac.takeoff-resolutions", {
    path,
  })) as RhvacTakeoffResolutionsResult;
}

/** Persist the deterministic ambiguity-flag resolutions sidecar beside the takeoff directory. */
export async function rhvacSaveTakeoffResolutions(
  args: RhvacTakeoffResolutionsArgs,
): Promise<RhvacTakeoffResolutionsResult> {
  return (await callHostDynamic(
    "rhvac.takeoff-resolutions",
    args,
  )) as RhvacTakeoffResolutionsResult;
}

export async function rhvacTakeoff(args: RhvacTakeoffArgs): Promise<RhvacTakeoffData> {
  const wire = (await callHostDynamic("rhvac.takeoff", args)) as RhvacTakeoffWire;
  const parsedLevels = wire.tsvs.map((file) => parseTakeoffTsv(file.text));
  return {
    levels: mergeTakeoffLevels(parsedLevels),
    roomMap: wire.roomMap ?? { matches: [], skip: [] },
    tsvSha256: Object.fromEntries(
      parsedLevels.map((level, index) => [level.levelName, wire.tsvs[index]!.sha256]),
    ),
  };
}
