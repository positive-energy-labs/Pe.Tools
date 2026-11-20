import { expect, test } from "vite-plus/test";
import { address } from "@pe/agent-contracts";
import { projectTakeoffSnapshot } from "./takeoff-ops.ts";

const rawSnapshot = {
  status: {
    systems: [],
  },
  zoneFrs: [
    {
      elementId: 42,
      typeName: "Zoning",
      view: "Zoning",
      color: "0,0,0",
      sqft: 100,
      role: "zoning-region",
      uniqueId: "zone-1",
      blob: JSON.stringify({ view: "Zoning", name: "Zone 1", systemTag: "FC-1" }),
      loops: [
        [
          [0, 0],
          [10, 0],
          [10, 10],
          [0, 10],
        ],
      ],
    },
  ],
  regionsByZone: {
    "zone-1": [
      {
        elementId: 84,
        role: "held-residue",
        uniqueId: "native-held-1",
        sqft: 100,
        blob: JSON.stringify({
          runId: "saved-run-1",
          sourceRoomId: "R01",
          partition: { disposition: 1, reason: "no-floor" },
        }),
        outer: [
          [0, 0],
          [10, 0],
          [10, 10],
          [0, 10],
        ],
        holes: [],
      },
      {
        elementId: 85,
        role: "held-residue",
        uniqueId: "native-void-1",
        sqft: 25,
        blob: JSON.stringify({
          runId: "saved-run-1",
          sourceRoomId: "R02",
          partition: { disposition: 2, reason: "low-headroom" },
        }),
        outer: [
          [10, 0],
          [15, 0],
          [15, 5],
          [10, 5],
        ],
        holes: [],
      },
    ],
  },
};

const recordedSnapshot = (snapshot: typeof rawSnapshot, path: string) =>
  ({
    reading: {
      at: address(path),
      version: "v1",
      observedAt: "2026-08-25T12:00:00.000Z",
    },
    snapshot,
  }) as unknown as Parameters<typeof projectTakeoffSnapshot>[0];

test("snapshot projection preserves held regions and saved review after partition", () => {
  const snapshot = projectTakeoffSnapshot(
    recordedSnapshot(rawSnapshot, "C:\\Models\\Harness.rvt"),
    "Harness.rvt",
    [
      { name: "Zoning", level: "Main" },
      { name: "Unadopted plan", level: "Upper" },
    ],
  );
  expect(snapshot.world.lanes).toEqual([
    { view: "Zoning", label: "Main", replayPath: null },
    { view: "Unadopted plan", label: "Upper", replayPath: null },
  ]);
  expect(snapshot.world).toMatchObject({
    docName: "Harness.rvt",
    zones: [
      {
        name: "Zone 1",
        heldSqft: 125,
        rooms: [],
        residues: [
          { id: "native-held-1", reason: "held", rawSqft: 100 },
          { id: "native-void-1", reason: "void", rawSqft: 25 },
        ],
        savedReview: {
          source: { runId: "saved-run-1" },
          shapes: [
            {
              id: "native-held-1",
              kind: "residue",
              disposition: null,
              original: { sourceRoomId: "R01", disposition: "held", reason: "no-floor" },
              reason: expect.stringContaining("measurements unmeasured"),
              loops: [
                [
                  [0, 0],
                  [10, 0],
                  [10, 10],
                  [0, 10],
                ],
              ],
            },
            {
              id: "native-void-1",
              kind: "residue",
              disposition: null,
              original: { sourceRoomId: "R02", disposition: "void", reason: "low-headroom" },
              reason: expect.stringContaining("measurements unmeasured"),
            },
          ],
        },
      },
    ],
  });
  expect(snapshot.reading).toMatchObject({
    at: "C:\\Models\\Harness.rvt",
    version: "v1",
  });
});

test("a machine-local original missing from a residue is neither held nor void", () => {
  const state = structuredClone(rawSnapshot);
  const residue = state.regionsByZone["zone-1"][0]!;
  residue.blob = JSON.stringify({
    runId: "saved-run-1",
    sourceRoomId: "R01",
    originalTrace: "a".repeat(64),
  });
  const room = {
    ...residue,
    role: "room-region",
    uniqueId: "room-missing",
    blob: JSON.stringify({ ...JSON.parse(residue.blob), sourceSqft: 100 }),
  };
  state.regionsByZone["zone-1"].push(room);
  const result = projectTakeoffSnapshot(recordedSnapshot(state, "C:/Harness.rvt"), "Harness.rvt", [
    { name: "Zoning", level: "Main" },
  ]);
  expect(result.world.zones[0]).toMatchObject({
    heldSqft: 25,
    rooms: [{ provenance: { originalIssue: "original not on this machine" } }],
    residues: [{ reason: "original not on this machine" }, { reason: "void" }],
    savedReview: {
      shapes: [
        { original: { disposition: null, reason: "original not on this machine" } },
        { original: { disposition: "void" } },
        { original: { disposition: null, reason: "original not on this machine" } },
      ],
    },
  });
});

test("a carrier blob's old resolutions suppress no flag: decisions come from Work only", () => {
  const blob = JSON.stringify({
    runId: "run-1",
    sourceRoomId: "R01",
    sourceSqft: 100,
    flags: ["seedless"],
    resolutions: [{ subject: "R01", flag: "seedless", verb: "dismiss", at: "t", runId: "run-1" }],
  });
  const snapshot = projectTakeoffSnapshot(
    {
      reading: {
        at: address("C:\\Models\\Harness.rvt"),
        version: "v1",
        observedAt: "2026-09-18T12:00:00.000Z",
      },
      snapshot: {
        ...rawSnapshot,
        regionsByZone: {
          "zone-1": [
            {
              elementId: 90,
              role: "room-region",
              guid: "room-1",
              sqft: 100,
              roomType: "office",
              blob,
              analysis: { state: "current", runId: "run-1", floorZ: 0, ceilingZ: 9 },
              outer: [
                [0, 0],
                [10, 0],
                [10, 10],
                [0, 10],
              ],
              holes: [],
            },
          ],
        },
      },
    } as unknown as Parameters<typeof projectTakeoffSnapshot>[0],
    "Harness.rvt",
    [{ name: "Zoning", level: "Main" }],
  );
  const [room] = snapshot.world.zones[0]!.rooms;
  expect(room!.flags).toContain("seedless");
  // A projected room carries no verdicts at all: they are edit Work cells only.
  expect(room).not.toHaveProperty("decisions");
});
