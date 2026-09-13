import { createHash, randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { Effect, FileSystem, Option, Stream } from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";
import type {
  RhvacAssemblyCatalogData,
  RhvacExtractData,
  RhvacInsertRoomData,
  RhvacLaunchResult,
  RhvacListData,
  RhvacListRequest,
  RhvacPathRequest,
  RhvacSyncRequest,
  RhvacSyncResult,
  RhvacTakeoffData,
} from "@pe/host-contracts/operation-types";
import {
  readDirectoryEntriesOrEmpty,
  readFileStringBomAwareOrEmpty,
  statOrNull,
} from "./files/index.ts";
import { hostOwnership } from "./host-ownership.ts";
import { LocalOpError } from "./local-error.ts";

/**
 * RHVAC .r10 local ops. An .r10 file is an Access 97 Jet database only the
 * 32-bit Jet driver can open, so open/assemblies/sync spawn the repo's proven
 * scripts (source/Pe.Revit.Takeoff/Rhvac/*.ps1) under SysWOW64 PowerShell and
 * exchange JSON through temp files. Pure file/process ops — no Revit session.
 *
 * Script paths resolve from hostOwnership.sourceRoot (<repo>/source/pe-tools →
 * <repo>/source/Pe.Revit.Takeoff/Rhvac), so the lane exists on dev hosts only;
 * the installed lane reports a clear "unavailable" error instead of guessing.
 */

const PS32_EXE = "C:\\Windows\\SysWOW64\\WindowsPowerShell\\v1.0\\powershell.exe";
// project-a (150 rooms, the firm's most complex file) extracts in ~10-30s in the
// 32-bit lane; edits do per-room queries on top of a full copy. Generous but bounded.
const EXTRACT_TIMEOUT_MS = 120_000;
const SAVE_TIMEOUT_MS = 300_000;

export function rhvacScriptDirectory(): string | null {
  return hostOwnership.sourceRoot === null
    ? null
    : resolve(hostOwnership.sourceRoot, "..", "Pe.Revit.Takeoff", "Rhvac");
}

export const rhvacOpen = Effect.fnUntraced(function* (input: RhvacPathRequest) {
  const key = "rhvac.open";
  yield* assertR10File(key, input.path);
  const outputPath = tempJsonPath("open");
  return yield* Effect.ensuring(
    Effect.gen(function* () {
      yield* runRhvacScript(key, "extract-rhvac.ps1", ["-Path", input.path, "-Output", outputPath]);
      return (yield* readJsonOutput(key, outputPath)) as RhvacExtractData;
    }),
    removeQuietly(outputPath),
  );
});

export const rhvacAssemblies = Effect.fnUntraced(function* (input: RhvacPathRequest) {
  const key = "rhvac.assemblies";
  yield* assertR10File(key, input.path);
  const outputPath = tempJsonPath("assemblies");
  return yield* Effect.ensuring(
    Effect.gen(function* () {
      yield* runRhvacScript(key, "extract-rhvac.ps1", [
        "-Path",
        input.path,
        "-Output",
        outputPath,
        "-Assemblies",
      ]);
      return (yield* readJsonOutput(key, outputPath)) as RhvacAssemblyCatalogData;
    }),
    removeQuietly(outputPath),
  );
});

/**
 * The one atomic write lane for a .r10 the engineer keeps: seed systems, insert new rooms, update
 * existing ones, optionally drop the template's blank seed room — then swap the target in place
 * behind a lock check, a working copy, validation, and a timestamped backup (sync-rhvac.ps1 owns
 * that envelope; export-rhvac.ps1 owns every SQL statement).
 *
 * This writes the target ITSELF rather than a separate output file: the .r10 is the engineer's
 * home for this data, and a sync that leaves a copy behind moves the truth question onto the user.
 */
export const rhvacSync = Effect.fnUntraced(function* (
  input: RhvacSyncRequest,
  expectedVersion?: string,
) {
  const key = "rhvac.sync";
  yield* assertR10File(key, input.targetPath);
  if (input.inserts.length === 0 && input.updates.length === 0 && !input.deleteUntouchedSeedRoom)
    return yield* invalid(key, "sync carries no inserts, no updates, and no seed-room deletion.");

  const systems = input.systems ?? [];
  const knownSystems = new Set(systems.map((system) => system.number));
  // The lane refuses orphans too (Jet does not enforce Room.SystemNumber -> System.Number), but a
  // room referencing a system the caller never mentioned is a caller bug worth naming here.
  for (const room of [...input.inserts, ...input.updates])
    if (systems.length > 0 && !knownSystems.has(room.systemNumber))
      return yield* invalid(
        key,
        `room ${room.number} references system ${room.systemNumber}, which is not in the request's systems list [${[...knownSystems].join(", ")}]. List it (existing systems are left untouched) or fix the room.`,
      );

  const payload = yield* Effect.try({
    try: () => ({
      systems: systems.map((system) => ({ Number: system.number, Name: system.name })),
      inserts: input.inserts.map((room) => toLaneRoom(key, room)),
      updates: input.updates.map((room) => ({
        Identifier: room.identifier,
        ...toLaneRoom(key, room),
      })),
      deletes: [],
      deleteUntouchedSeedRoom: input.deleteUntouchedSeedRoom === true,
    }),
    catch: (error) =>
      error instanceof LocalOpError ? error : new LocalOpError(key, describeError(error)),
  });

  const fs = yield* FileSystem.FileSystem;
  const syncPath = tempJsonPath("sync");
  const resultPath = tempJsonPath("sync-result");
  yield* fs
    .writeFileString(syncPath, JSON.stringify(payload))
    .pipe(Effect.mapError((error) => new LocalOpError(key, describeError(error))));

  return yield* Effect.ensuring(
    Effect.gen(function* () {
      const log = yield* runRhvacScript(
        key,
        "sync-rhvac.ps1",
        [
          "-Target",
          input.targetPath,
          "-SyncJson",
          syncPath,
          "-ResultJson",
          resultPath,
          ...(expectedVersion ? ["-ExpectedVersion", expectedVersion] : []),
          ...(input.whatIf ? ["-WhatIf"] : []),
        ],
        SAVE_TIMEOUT_MS,
      );
      const result = (yield* readJsonOutput(key, resultPath)) as RhvacSyncResult;
      return {
        targetPath: result.targetPath,
        backupPath: result.backupPath ?? null,
        swapped: result.swapped,
        fileIdentity: result.fileIdentity,
        systems: result.systems,
        insertedRooms: result.insertedRooms,
        updated: result.updated,
        seedRoom: result.seedRoom,
        assemblyFallbacks: result.assemblyFallbacks,
        roomsBefore: result.roomsBefore,
        roomsAfter: result.roomsAfter,
        log,
      } satisfies RhvacSyncResult;
    }),
    Effect.all([removeQuietly(syncPath), removeQuietly(resultPath)]),
  );
});

/**
 * Hand an .r10 to Elite RHVAC through its Windows file association. Fire-and-forget: `start`
 * returns as soon as the shell accepts the open, and RHVAC's load recalculation stays a manual
 * step (there is no headless calc — see docs/features/takeoffs/rhvac-and-mj-reference.md).
 */
export const rhvacLaunch = Effect.fnUntraced(function* (
  input: RhvacPathRequest,
  launch?: (path: string) => Promise<void>,
) {
  const key = "rhvac.launch";
  yield* assertR10File(key, input.path);
  if (launch) {
    yield* Effect.tryPromise({
      try: () => launch(input.path),
      catch: (error) => new LocalOpError(key, describeError(error)),
    });
    return { path: input.path, launched: true, simulated: true };
  }
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  // `start` is a cmd builtin, not an executable; the empty string is its window-title argument,
  // without which cmd treats a quoted path as the title and opens nothing.
  const command = ChildProcess.make("cmd.exe", ["/c", "start", "", input.path]);
  const exitCode = yield* Effect.scoped(
    Effect.gen(function* () {
      const handle = yield* spawner.spawn(command);
      return yield* handle.exitCode;
    }),
  ).pipe(Effect.mapError((error) => new LocalOpError(key, describeError(error))));
  if (exitCode !== 0)
    return yield* Effect.fail(
      new LocalOpError(key, `the shell refused to open ${input.path} (exit ${exitCode})`),
    );
  return { path: input.path, launched: true } satisfies RhvacLaunchResult;
});

/** Every .r10 in one folder — the legal-options source for a route's `.r10` binding. */
export const rhvacList = Effect.fnUntraced(function* (input: RhvacListRequest) {
  const key = "rhvac.list";
  const exists = (yield* statOrNull(input.dir, key))?.type === "Directory";
  const entries = exists ? yield* readDirectoryEntriesOrEmpty(input.dir, key) : [];
  const files = entries
    .filter((entry) => entry.info.type === "File" && entry.name.toLowerCase().endsWith(".r10"))
    .map((entry) => ({
      name: entry.name,
      path: join(input.dir, entry.name),
      modifiedUnixMs: Option.getOrUndefined(entry.info.mtime)?.getTime() ?? 0,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
  return { dir: input.dir, exists, files } satisfies RhvacListData;
});

/**
 * Takeoff snapshots for an .r10 project. `path` is the .r10 FILE path; the op
 * looks for the repo's fixture convention next to it: `<dir>/takeoff/*.tsv`
 * (raw TSV texts, returned unparsed) and `<dir>/room-map.json`. No takeoff
 * data is an empty result, not an error — the plan overlay is optional.
 */
export const rhvacTakeoff = Effect.fnUntraced(function* (input: RhvacPathRequest) {
  const key = "rhvac.takeoff";
  if (!input.path.toLowerCase().endsWith(".r10"))
    return yield* invalid(key, `path must be the .r10 file path, got: ${input.path}`);
  const projectDir = dirname(input.path);
  const takeoffDir = join(projectDir, "takeoff");
  const entries = yield* readDirectoryEntriesOrEmpty(takeoffDir, key);
  const tsvNames = entries
    .filter((entry) => entry.info.type === "File" && entry.name.toLowerCase().endsWith(".tsv"))
    .map((entry) => entry.name)
    .sort();
  const tsvs = yield* Effect.all(
    tsvNames.map((name) =>
      readFileStringBomAwareOrEmpty(join(takeoffDir, name), key).pipe(
        Effect.map((text) => ({
          name,
          text,
          sha256: createHash("sha256").update(text, "utf8").digest("hex"),
        })),
      ),
    ),
  );
  const roomMapText = yield* readFileStringBomAwareOrEmpty(join(projectDir, "room-map.json"), key);
  const roomMap =
    roomMapText.length === 0
      ? null
      : ((yield* parseJson(key, roomMapText, "room-map.json")) as RhvacTakeoffData["roomMap"]);
  return {
    tsvs: tsvs.filter((file) => file.text.length > 0),
    roomMap,
  } satisfies RhvacTakeoffData;
});

// --- edit payload conversion ---------------------------------------------------

/**
 * Convert one extract-shaped room (camelCase, flat glass/doors pointing at wall
 * ordinals) into export-rhvac.ps1's room shape (PascalCase C# RhvacRoom, openings
 * nested under their wall). Openings match walls by `index1`; blob regeneration
 * compacts ordinals to the 1..N order sent here.
 */
function toLaneRoom(key: string, room: RhvacInsertRoomData) {
  const wallOrdinals = new Set(room.walls.map((wall) => wall.index1));
  for (const [category, openings] of [
    ["glass", room.glass],
    ["doors", room.doors],
  ] as const) {
    for (const opening of openings)
      if (!wallOrdinals.has(opening.wallReference))
        throw new LocalOpError(
          key,
          `room ${room.number}: ${category} references wall ordinal ${opening.wallReference}, but the room's walls are [${[...wallOrdinals].join(", ")}]. Fix the reference before saving.`,
          400,
        );
  }
  return {
    Number: room.number,
    Name: room.name,
    AreaSquareFeet: room.areaSquareFeet,
    CeilingHeightFeet: room.ceilingHeightFeet,
    SystemNumber: room.systemNumber,
    ZoneNumber: room.zoneNumber,
    InternalLoads: {
      People: room.people,
      LightingWatts: room.lightingWatts,
      SensibleEquipmentBtuh: room.equipmentSensibleBtuh,
      LatentEquipmentBtuh: room.equipmentLatentBtuh,
      VentilationCfm: room.ventilationCfm,
    },
    Floors: room.floors.map((floor) => ({
      Assembly: { Name: floor.assembly, UValue: floor.uValue },
      AreaSquareFeet: floor.areaSquareFeet,
      ExposedPerimeterFeet: floor.exposedPerimeterFeet,
    })),
    Roofs: room.roofs.map((roof) => ({
      Assembly: { Name: roof.assembly, UValue: roof.uValue },
      AreaSquareFeet: roof.areaSquareFeet,
      AreaMultiplier: roof.areaMultiplier,
    })),
    Walls: room.walls.map((wall) => ({
      Assembly: { Name: wall.assembly, UValue: wall.uValue },
      LengthFeet: wall.lengthFeet,
      HeightFeet: wall.heightFeet,
      Direction: wall.direction,
      Windows: room.glass
        .filter((glass) => glass.wallReference === wall.index1)
        .map((glass) => ({
          Assembly: { Name: glass.assembly, UValue: glass.uValue },
          WidthFeet: glass.widthFeet,
          HeightFeet: glass.heightFeet,
          SolarHeatGainCoefficient: glass.shgc,
          Occurrences: glass.occurrences,
        })),
      Doors: room.doors
        .filter((door) => door.wallReference === wall.index1)
        .map((door) => ({
          Assembly: { Name: door.assembly, UValue: door.uValue },
          WidthFeet: door.widthFeet,
          HeightFeet: door.heightFeet,
        })),
    })),
  };
}

// --- 32-bit lane plumbing ------------------------------------------------------

const runRhvacScript = Effect.fnUntraced(function* (
  key: string,
  scriptName: string,
  scriptArgs: readonly string[],
  timeoutMs: number = EXTRACT_TIMEOUT_MS,
) {
  const scriptDirectory = rhvacScriptDirectory();
  if (scriptDirectory === null)
    return yield* Effect.fail(
      new LocalOpError(
        key,
        "rhvac.* ops spawn the repo's 32-bit Jet scripts (source/Pe.Revit.Takeoff/Rhvac); this host has no source root, so the lane is unavailable on the installed lane.",
        501,
      ),
    );
  const scriptPath = join(scriptDirectory, scriptName);
  if ((yield* statOrNull(scriptPath, key))?.type !== "File")
    return yield* Effect.fail(new LocalOpError(key, `script not found: ${scriptPath}`));
  if ((yield* statOrNull(PS32_EXE, key))?.type !== "File")
    return yield* Effect.fail(
      new LocalOpError(
        key,
        `32-bit PowerShell not found at ${PS32_EXE}; the Jet 3.5 driver only loads in a 32-bit process.`,
      ),
    );

  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const command = ChildProcess.make(PS32_EXE, [
    "-NoProfile",
    "-NonInteractive",
    "-ExecutionPolicy",
    "Bypass",
    "-File",
    scriptPath,
    ...scriptArgs,
  ]);
  const run = Effect.scoped(
    Effect.gen(function* () {
      const handle = yield* spawner.spawn(command);
      // `all` interleaves stdout + stderr, so script throw sites land in the error note.
      return yield* Effect.all(
        {
          output: Stream.mkString(Stream.decodeText(handle.all)),
          exitCode: handle.exitCode,
        },
        { concurrency: "unbounded" },
      );
    }),
  );
  const outcome = yield* Effect.timeout(run, timeoutMs).pipe(
    Effect.mapError(
      (error) =>
        new LocalOpError(
          key,
          isTimeout(error)
            ? `${scriptName} timed out after ${Math.round(timeoutMs / 1000)}s; the 32-bit Jet lane may be wedged on the file.`
            : `${scriptName} lane failed: ${describeError(error)}`,
        ),
    ),
  );
  if (outcome.exitCode !== 0)
    return yield* Effect.fail(
      new LocalOpError(key, `${scriptName} exited ${outcome.exitCode}: ${tailOf(outcome.output)}`),
    );
  return outcome.output;
});

const assertR10File = Effect.fnUntraced(function* (key: string, path: string) {
  if (!path.toLowerCase().endsWith(".r10"))
    return yield* invalid(key, `path must be an .r10 file, got: ${path}`);
  if ((yield* statOrNull(path, key))?.type !== "File")
    return yield* Effect.fail(new LocalOpError(key, `.r10 file not found: ${path}`, 404));
});

const readJsonOutput = Effect.fnUntraced(function* (key: string, path: string) {
  const text = yield* readFileStringBomAwareOrEmpty(path, key);
  if (text.length === 0)
    return yield* Effect.fail(
      new LocalOpError(key, `script reported success but wrote no output at ${path}`),
    );
  return yield* parseJson(key, text, path);
});

const parseJson = Effect.fnUntraced(function* (key: string, text: string, label: string) {
  return yield* Effect.try({
    try: () => JSON.parse(text) as unknown,
    catch: (error) => new LocalOpError(key, `${label} is not valid JSON: ${describeError(error)}`),
  });
});

function tempJsonPath(purpose: string): string {
  return join(tmpdir(), `pe-rhvac-${purpose}-${randomUUID()}.json`);
}

function removeQuietly(path: string) {
  return Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    yield* fs.remove(path).pipe(Effect.ignore);
  });
}

function invalid(key: string, note: string) {
  return Effect.fail(new LocalOpError(key, note, 400));
}

function tailOf(output: string): string {
  const trimmed = output.trim();
  return trimmed.length > 2000 ? `…${trimmed.slice(-2000)}` : trimmed;
}

function isTimeout(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "_tag" in error &&
    error._tag === "TimeoutException"
  );
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
