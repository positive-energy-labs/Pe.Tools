/**
 * RHVAC .r10 file access over the four `rhvac.*` host local ops (apps/host/
 * src/rhvac-ops.ts — TS-only ops spawning the repo's 32-bit Jet scripts).
 *
 * Contract (all paths are host-visible, e.g. G:\\projects\\job\\project.r10):
 *   rhvac.open       { path }                          → RhvacExtract
 *   rhvac.assemblies { path }                          → RhvacAssemblyCatalog
 *   rhvac.save       { sourcePath, outputPath, edits } → RhvacSaveResult
 *   rhvac.takeoff    { path }                          → raw TSVs + room map
 *
 * rhvac.takeoff takes the .r10 FILE path and returns the raw takeoff TSV texts
 * (`<dir>/takeoff/*.tsv`) plus `<dir>/room-map.json` found next to it; parsing
 * stays client-side (parseTakeoffTsv), matching the fixture lane. Missing
 * takeoff data is an empty result, not an error.
 */
import { callHostDynamic } from "#/host/client";
import type { ResolutionsFile } from "#/rhvac/resolutions";
import { parseTakeoffTsv } from "#/rhvac/takeoff";
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
  tsvs: { name: string; text: string }[];
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

export interface RhvacTakeoffResolutionsArgs {
  /** The .r10 FILE path — the op writes `<dir>/takeoff-resolutions.json` next to the takeoff dir. */
  path: string;
  resolutions: ResolutionsFile;
}

/**
 * CONTRACT STUB — `rhvac.takeoff-resolutions` is not implemented host-side yet.
 * Persists the ambiguity-flag resolutions sidecar (deterministic JSON, no
 * timestamps) next to the takeoff TSVs so resolved splits/accepts replay in
 * every session and feed back into candidate generation. Until the op lands,
 * the UI keeps resolutions in localStorage and offers a JSON download
 * (src/rhvac/resolutions.ts) — same graceful degradation as the other ops.
 */
export async function rhvacSaveTakeoffResolutions(
  args: RhvacTakeoffResolutionsArgs,
): Promise<{ savedPath: string }> {
  return (await callHostDynamic("rhvac.takeoff-resolutions", args)) as { savedPath: string };
}

export async function rhvacTakeoff(args: RhvacTakeoffArgs): Promise<RhvacTakeoffData> {
  const wire = (await callHostDynamic("rhvac.takeoff", args)) as RhvacTakeoffWire;
  return {
    levels: wire.tsvs.map((file) => parseTakeoffTsv(file.text)),
    roomMap: wire.roomMap ?? { matches: [], skip: [] },
  };
}
