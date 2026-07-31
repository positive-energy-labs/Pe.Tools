import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Effect, FileSystem } from "effect";
import { NodeHttpClient, NodeServices } from "@effect/platform-node";
import type { HttpClient } from "effect/unstable/http";
import type { ChildProcessSpawner } from "effect/unstable/process";
import { expect, test } from "vite-plus/test";
import type {
  RhvacAssemblyCatalogData,
  RhvacExtractData,
  RhvacRoomData,
  RhvacSaveResult,
  RhvacTakeoffData,
} from "@pe/host-contracts/operation-types";
import type { RevitBridge } from "../src/bridge.ts";
import { dispatchTsOnlyOperation } from "../src/call-route.ts";
import { LocalOpError } from "../src/local-error.ts";
import { rhvacScriptDirectory } from "../src/rhvac-ops.ts";

/**
 * End-to-end smoke for the rhvac.* local ops through the real dispatch path
 * (dispatchTsOnlyOperation — exactly what POST /call runs after envelope
 * parsing), against the real gitignored project-a copy in the 32-bit Jet
 * lane. No Revit session involved; the bridge stub proves that.
 *
 * Skips (does not fail) when the machine lacks the lane or the local fixture:
 * CI has neither eval/rhvac/project-a/projectA.local.r10 nor SysWOW64 PowerShell.
 */

const PS32_EXE = "C:\\Windows\\SysWOW64\\WindowsPowerShell\\v1.0\\powershell.exe";
const scriptDir = rhvacScriptDirectory();
const repoRoot = scriptDir ? resolve(scriptDir, "..", "..", "..") : null;
const ProjectAR10 = repoRoot ? join(repoRoot, "eval", "rhvac", "project-a", "projectA.local.r10") : null;
const laneAvailable =
  process.platform === "win32" &&
  existsSync(PS32_EXE) &&
  ProjectAR10 !== null &&
  existsSync(ProjectAR10);

const stubBridge = {
  invoke: () => Effect.die("rhvac ops must not touch the Revit bridge"),
  snapshot: () => Effect.die("rhvac ops must not touch the Revit bridge"),
  list: Effect.succeed([]),
} as unknown as RevitBridge["Service"];

function dispatch<A = unknown>(key: string, request: unknown): Promise<A> {
  return Effect.runPromise(
    (
      dispatchTsOnlyOperation(key as never, request, undefined, stubBridge) as Effect.Effect<
        unknown,
        unknown,
        ChildProcessSpawner.ChildProcessSpawner | FileSystem.FileSystem | HttpClient.HttpClient
      >
    ).pipe(Effect.provide(NodeServices.layer), Effect.provide(NodeHttpClient.layerUndici)),
  ) as Promise<A>;
}

test("rhvac ops validate inputs without touching the Jet lane", async () => {
  await expect(dispatch("rhvac.open", { path: "C:\\nope\\project.rvt" })).rejects.toMatchObject({
    _tag: "LocalOpError",
    statusCode: 400,
  });
  await expect(
    dispatch("rhvac.save", {
      sourcePath: "C:\\nope\\missing.r10",
      outputPath: "C:\\nope\\missing.r10",
      edits: { updates: [], deletes: [] },
    }),
    // missing source reports 404 before the same-path refusal is even reached
  ).rejects.toBeInstanceOf(LocalOpError);
  await expect(dispatch("rhvac.takeoff", { path: "C:\\nope\\project.txt" })).rejects.toMatchObject({
    _tag: "LocalOpError",
    statusCode: 400,
  });
});

test.skipIf(!laneAvailable)(
  "rhvac.takeoff returns the raw TSV snapshots + room map next to the .r10",
  async () => {
    const takeoff = await dispatch<RhvacTakeoffData>("rhvac.takeoff", { path: ProjectAR10 });
    expect(takeoff.tsvs.length).toBe(5);
    for (const file of takeoff.tsvs) {
      expect(file.name.endsWith(".tsv")).toBe(true);
      expect(file.text).toContain("META\tlevel");
    }
    expect(takeoff.roomMap).not.toBeNull();
    expect(takeoff.roomMap!.matches.length).toBeGreaterThan(0);
  },
);

test("rhvac.takeoff without takeoff data is empty, not an error", async () => {
  const emptyDir = mkdtempSync(join(tmpdir(), "pe-rhvac-empty-"));
  try {
    // Deliberately dumb: the op never opens the .r10 itself, it only looks for
    // takeoff snapshots next to the given path.
    const takeoff = await dispatch<RhvacTakeoffData>("rhvac.takeoff", {
      path: join(emptyDir, "lonely.r10"),
    });
    expect(takeoff).toEqual({ tsvs: [], roomMap: null });
  } finally {
    rmSync(emptyDir, { recursive: true, force: true });
  }
});

test.skipIf(!laneAvailable)(
  "rhvac open → assemblies → save → re-open round-trip on the project-a copy",
  { timeout: 600_000 },
  async () => {
    // --- open: 150 rooms, real identifiers ---
    const extract = await dispatch<RhvacExtractData>("rhvac.open", { path: ProjectAR10 });
    expect(extract.rooms.length).toBe(150);
    expect(extract.rooms.every((room) => Number.isInteger(room.identifier))).toBe(true);
    expect(new Set(extract.rooms.map((room) => room.identifier)).size).toBe(150);
    expect(extract.systems.length).toBeGreaterThan(0);
    expect(extract.building.areaSquareFeet).toBeGreaterThan(0);

    // --- assemblies: non-empty per category ---
    const catalog = await dispatch<RhvacAssemblyCatalogData>("rhvac.assemblies", {
      path: ProjectAR10,
    });
    for (const category of ["floors", "roofs", "walls", "glass", "doors"] as const) {
      expect(catalog[category].length).toBeGreaterThan(0);
      expect(catalog[category][0].name.length).toBeGreaterThan(0);
    }

    // --- save: edit one projection-stable room, delete one other room ---
    // Projection-stable = compacted wall ordinals and wall-major opening order,
    // so re-extract reproduces everything but the intended edits verbatim
    // (rooms with zero-row padding legitimately re-extract with renumbered
    // ordinals — same selection rule as eval/rhvac/edit-check.ps1).
    const isEditable = (room: RhvacRoomData) =>
      room.walls.length > 0 &&
      room.glass.length > 0 &&
      room.walls.every((wall, i) => wall.index1 === i + 1) &&
      (
        [room.glass.map((g) => g.wallReference), room.doors.map((d) => d.wallReference)] as const
      ).every(
        (refs) =>
          refs.every((ref) => ref >= 1 && ref <= room.walls.length) &&
          refs.every((ref, i) => i === 0 || ref >= refs[i - 1]),
      );
    const target = extract.rooms.find(isEditable);
    expect(target).toBeDefined();
    const victim = [...extract.rooms].reverse().find((r) => r.identifier !== target!.identifier);
    expect(victim).toBeDefined();

    const editedRoom = { ...target!, areaSquareFeet: target!.areaSquareFeet + 25 };
    const workDir = mkdtempSync(join(tmpdir(), "pe-rhvac-smoke-"));
    const outputPath = join(workDir, "projectA.edited.r10");
    try {
      const saved = await dispatch<RhvacSaveResult>("rhvac.save", {
        sourcePath: ProjectAR10,
        outputPath,
        edits: { updates: [editedRoom], deletes: [victim!.identifier] },
      });
      expect(saved).toEqual({ outputPath, updated: 1, deleted: 1 });
      expect(existsSync(outputPath)).toBe(true);

      // --- re-open: exactly the intended edits, everything else identical ---
      const after = await dispatch<RhvacExtractData>("rhvac.open", { path: outputPath });
      expect(after.rooms.length).toBe(149);
      expect(after.rooms.some((room) => room.identifier === victim!.identifier)).toBe(false);

      const targetAfter = after.rooms.find((room) => room.identifier === target!.identifier)!;
      expect(targetAfter.areaSquareFeet).toBeCloseTo(target!.areaSquareFeet + 25, 2);
      // Neutralize the intended edit (float32 quantization), then projection-identical.
      expect({ ...targetAfter, areaSquareFeet: 0 }).toEqual({ ...target!, areaSquareFeet: 0 });

      const untouchedBefore = extract.rooms.filter(
        (room) => room.identifier !== target!.identifier && room.identifier !== victim!.identifier,
      );
      const afterById = new Map(after.rooms.map((room) => [room.identifier, room]));
      for (const room of untouchedBefore) expect(afterById.get(room.identifier)).toEqual(room);

      // save refuses sourcePath == outputPath
      await expect(
        dispatch("rhvac.save", {
          sourcePath: outputPath,
          outputPath,
          edits: { updates: [], deletes: [victim!.identifier] },
        }),
      ).rejects.toMatchObject({ _tag: "LocalOpError", statusCode: 400 });
    } finally {
      rmSync(workDir, { recursive: true, force: true });
    }
  },
);
