/**
 * RHVAC .r10 file access over host local ops. The four `rhvac.*` ops are
 * wave-2 work on the host side — this module is the web-side contract they
 * must satisfy. Until they land, every call rejects with a HostCallError and
 * the /rhvac route degrades to its fixture lane.
 *
 * Contract (all paths are host-visible, e.g. G:\\projects\\job\\project.r10):
 *   rhvac.open       { path }                          → RhvacExtract
 *   rhvac.assemblies { path }                          → RhvacAssemblyCatalog
 *   rhvac.save       { sourcePath, outputPath, edits } → RhvacSaveResult
 *   rhvac.takeoff    { path }                          → RhvacTakeoffData
 *
 * Untyped on the wire by design (callHostDynamic) — regenerate host-typegen
 * and switch to callHostRpc once the C# ops are checked in.
 */
import { callHostDynamic } from "#/host/client";
import {
  normalizeExtract,
  type RhvacAssemblyCatalog,
  type RhvacExtract,
  type RhvacRoom,
  type RhvacTakeoffData,
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
  /** The .r10 path (the op resolves the project's takeoff snapshots + room map from it). */
  path: string;
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

export async function rhvacTakeoff(args: RhvacTakeoffArgs): Promise<RhvacTakeoffData> {
  return (await callHostDynamic("rhvac.takeoff", args)) as RhvacTakeoffData;
}
