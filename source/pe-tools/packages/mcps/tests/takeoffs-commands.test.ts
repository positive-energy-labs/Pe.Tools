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
  regionsByZone: {},
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
        scope: { session: "dev-26", document: address("C:\\Models\\Harness.rvt") },
        getDoc: () => document,
        setDoc: async (next) => {
          Object.assign(document, next);
          writes += 1;
        },
      },
    );

    expect(writes).toBe(1);
    expect(targets.length).toBeGreaterThan(0);
    expect(targets.every((target) => target === "session:dev-26")).toBe(true);
    expect(document.snapshot?.world).toMatchObject({
      docName: "Harness.rvt",
      zones: [{ name: "Zone 1" }],
    });
    expect(document.snapshot?.reading).toMatchObject({
      at: "C:\\Models\\Harness.rvt",
      version: "v1",
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});
