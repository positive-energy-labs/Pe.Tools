import { expect, test } from "vite-plus/test";
import { address } from "@pe/agent-contracts";
import { projectTakeoffSnapshot } from "../src/shared/takeoff-ops.ts";

const rawSnapshot = {
  status: {
    systems: [],
    carriers: { stage: "Adoption", status: "ready", missingCarrierGuids: [] },
  },
  zoneFrs: [
    {
      elementId: 42,
      typeName: "Zoning",
      view: "Zoning",
      color: "0,0,0",
      sqft: 100,
      role: "zoning-region",
      guid: "zone-1",
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
        guid: "native-held-1",
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
        guid: "native-void-1",
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

test("snapshot projection preserves held regions and saved review after partition", () => {
  const snapshot = projectTakeoffSnapshot(
    {
      reading: {
        at: address("C:\\Models\\Harness.rvt"),
        version: "v1",
        observedAt: "2026-08-25T12:00:00.000Z",
      },
      snapshot: rawSnapshot,
    } as unknown as Parameters<typeof projectTakeoffSnapshot>[0],
    "Harness.rvt",
    [{ name: "Zoning", level: "Main" }],
  );
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
