import { expect, test } from "vite-plus/test";
import { address, type TakeoffsRouteDocument } from "@pe/agent-contracts";
import { HOST_RPC_BRIDGE_SESSION_HEADER } from "@pe/host-contracts/operation-types";
import { createTakeoffsCommandHandlers } from "../src/pea/takeoffs-commands.ts";

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

test("takeoffs audit targets the bound world and sets the document snapshot", async () => {
  const originalFetch = globalThis.fetch;
  const targets: (string | null)[] = [];
  globalThis.fetch = async (_input, init) => {
    targets.push(new Headers(init?.headers).get(HOST_RPC_BRIDGE_SESSION_HEADER));
    if (typeof init?.body !== "string") throw new Error("expected JSON request body");
    const body = JSON.parse(init.body) as {
      key: string;
      request?: unknown;
    };
    const data =
      body.key === "takeoffs.snapshot"
        ? {
            reading: {
              at: "C:\\Models\\Harness.rvt",
              version: "v1",
              observedAt: "2026-08-25T12:00:00.000Z",
            },
            snapshot: rawSnapshot,
          }
        : body.key === "revit.context.document-session"
          ? { activeDocument: { title: "Harness.rvt" } }
          : body.key === "revit.catalog.project-index"
            ? {
                views: [
                  {
                    handle: { elementId: 7 },
                    name: "Zoning",
                    viewType: "FloorPlan",
                    levelName: "Main",
                  },
                ],
              }
            : body.key === "takeoffs.views"
              ? { views: [{ elementId: 7, regions: 1 }] }
              : body.key === "takeoffs.prepare-capture"
                ? { level: "Main" }
                : body.key === "takeoffs.detect-capture"
                  ? { level: "Main", replayPath: "replay.bin", rooms: 1, totalSqft: 100 }
                  : {};
    return new Response(JSON.stringify(data), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
  try {
    const document: TakeoffsRouteDocument = { bindings: {}, snapshot: null, staged: [] };
    let writes = 0;
    await createTakeoffsCommandHandlers({ hostBaseUrl: "http://127.0.0.1:1" }).audit(
      { view: "Zoning", zones: ["zone-1"] },
      {
        scope: { kind: "document", document: address("C:\\Models\\Harness.rvt"), pin: "dev-26" },
        getDoc: () => document,
        setDoc: async (next) => {
          Object.assign(document, next);
          writes += 1;
        },
      },
    );

    expect(writes).toBe(1);
    expect(targets.length).toBeGreaterThan(0);
    expect(targets.every((target) => target === "pin:dev-26|doc:C:\\Models\\Harness.rvt")).toBe(
      true,
    );
    expect(document.snapshot?.world).toMatchObject({
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
    expect(document.snapshot?.reading).toMatchObject({
      at: "C:\\Models\\Harness.rvt",
      version: "v1",
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});
