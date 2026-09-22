import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
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
  RhvacTakeoffData,
} from "@pe/host-contracts/operation-types";
import type { RevitBridge } from "../src/bridge.ts";
import { dispatchTsOnlyOperation, InvalidHostRequest } from "../src/call-route.ts";
import { rhvacScriptDirectory } from "../src/rhvac-ops.ts";

/**
 * End-to-end smoke for the rhvac.* local ops through the real dispatch path
 * (dispatchTsOnlyOperation — exactly what POST /call runs after envelope
 * parsing), against the private projectA .r10 copy in the 32-bit Jet
 * lane. No Revit session involved; the bridge stub proves that.
 *
 * Skips (does not fail) when the machine lacks the lane or the local fixture:
 * CI has neither .private/fixtures/project-a/rhvac/local.r10 nor SysWOW64 PowerShell.
 */

const PS32_EXE = "C:\\Windows\\SysWOW64\\WindowsPowerShell\\v1.0\\powershell.exe";
const scriptDir = rhvacScriptDirectory();
const repoRoot = scriptDir ? resolve(scriptDir, "..", "..", "..") : null;
const ProjectAR10 = repoRoot
  ? join(process.env.PE_PRIVATE_FIXTURES ?? join(repoRoot, ".private", "fixtures"), "project-a", "rhvac", "local.r10")
  : null;
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
  await expect(dispatch("rhvac.takeoff", { path: "C:\\nope\\project.txt" })).rejects.toMatchObject({
    _tag: "LocalOpError",
    statusCode: 400,
  });
  await expect(dispatch("rhvac.launch", { path: "C:\\nope\\project.pdf" })).rejects.toMatchObject({
    _tag: "LocalOpError",
    statusCode: 400,
  });
  await expect(dispatch("rhvac.launch", { path: "C:\\nope\\missing.r10" })).rejects.toMatchObject({
    _tag: "LocalOpError",
    statusCode: 404,
  });
});

test("rhvac.sync refuses malformed syncs before it can touch a file", async () => {
  const projectDir = mkdtempSync(join(tmpdir(), "pe-rhvac-sync-"));
  try {
    const targetPath = join(projectDir, "project.r10");
    writeFileSync(targetPath, "");
    const room = (overrides: Record<string, unknown> = {}) => ({
      number: 101,
      name: "Great Room",
      systemNumber: 3,
      zoneNumber: 1,
      areaSquareFeet: 420,
      ceilingHeightFeet: 10,
      people: 0,
      lightingWatts: 105,
      equipmentSensibleBtuh: 0,
      equipmentLatentBtuh: 0,
      ventilationCfm: 40,
      floors: [],
      roofs: [],
      walls: [
        { index1: 1, assembly: "W", uValue: 0.06, lengthFeet: 20, heightFeet: 10, direction: 0 },
      ],
      glass: [],
      doors: [],
      ...overrides,
    });

    // Nothing to do is a caller bug, not a no-op write.
    await expect(
      dispatch("rhvac.sync", { targetPath, inserts: [], updates: [] }),
    ).rejects.toMatchObject({ _tag: "LocalOpError", statusCode: 400 });
    // A room pointing at a system the caller never listed would orphan in Jet, which enforces nothing.
    await expect(
      dispatch("rhvac.sync", {
        targetPath,
        inserts: [room()],
        updates: [],
        systems: [{ number: 1, name: "Down" }],
      }),
    ).rejects.toMatchObject({ _tag: "LocalOpError", statusCode: 400 });
    // A window hanging off a wall ordinal the room does not have.
    await expect(
      dispatch("rhvac.sync", {
        targetPath,
        inserts: [
          room({
            glass: [
              {
                assembly: "G",
                uValue: 0.3,
                widthFeet: 4,
                heightFeet: 5,
                wallReference: 9,
                shgc: 0.25,
                occurrences: 1,
              },
            ],
          }),
        ],
        updates: [],
        systems: [{ number: 3, name: "IU-3" }],
      }),
    ).rejects.toMatchObject({ _tag: "LocalOpError", statusCode: 400 });
    // An insert carrying an identifier is a shape error: Jet's COUNTER assigns it.
    await expect(
      dispatch("rhvac.sync", {
        targetPath,
        inserts: [room({ identifier: 7 })],
        updates: [],
        systems: [{ number: 3, name: "IU-3" }],
      }),
    ).rejects.toBeInstanceOf(InvalidHostRequest);
  } finally {
    rmSync(projectDir, { recursive: true, force: true });
  }
});

test.skipIf(!laneAvailable)(
  "rhvac.takeoff returns the raw TSV snapshots + room map next to the .r10",
  async () => {
    const takeoff = await dispatch<RhvacTakeoffData>("rhvac.takeoff", { path: ProjectAR10 });
    expect(takeoff.tsvs.length).toBe(5);
    for (const file of takeoff.tsvs) {
      expect(file.name.endsWith(".tsv")).toBe(true);
      expect(file.text).toContain("META\tlevel");
      expect(file.sha256).toMatch(/^[0-9a-f]{64}$/);
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
  "rhvac open → assemblies on the project-a copy",
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
  },
);
