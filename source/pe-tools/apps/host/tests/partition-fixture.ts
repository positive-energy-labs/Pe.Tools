import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { address, takeoffsRouteState, type DocumentRef } from "@pe/agent-contracts";
import { RouteWorkspace } from "../../../packages/runtime/src/route-workspace.ts";
import { TakeoffCaptures } from "../src/takeoff-captures.ts";
export async function partitionFixture(dir: string, target: DocumentRef) {
  const at = address("C:/model.rvt");
  const scope = { route: "takeoffs", target: at };
  const workFile = join(dir, "work.json");
  const workspace = new RouteWorkspace({
    registrations: [{ spec: takeoffsRouteState, handlers: {} }],
    store: {
      getState: async () =>
        readFile(workFile, "utf8")
          .then(JSON.parse)
          .catch((error) => {
            if (error.code === "ENOENT") return undefined;
            throw error;
          }),
      setState: async ({ value }) => {
        await writeFile(workFile, JSON.stringify(value));
      },
    },
  });
  await workspace.apply(
    scope,
    "takeoffs",
    "human",
    [
      {
        path: ["staged"],
        value: [{ roomId: "room-1", base: { name: "Before" }, next: { name: "Reviewed" } }],
      },
    ],
    0,
  );
  const candidate = {
    elementId: 41,
    typeName: "Zone",
    view: "Level 1",
    color: "blue",
    sqft: 100,
    role: "zone",
    guid: "zone-1",
    blob: "",
    loops: [],
  };
  const captures = new TakeoffCaptures(join(dir, "captures"));
  const { capture } = await captures.refresh(
    target,
    async () => ({
      result: {},
      snapshot: {
        reading: { at, version: "reviewed", observedAt: "2026-09-09T18:00:00.000Z" },
        carriers: { stage: "Materialization", status: "ready", missingCarrierGuids: [] },
        world: { docName: "Model", r10Path: null, lanes: [], zones: [], systems: [] },
        zoneFrs: [candidate],
        regionsByZone: {},
      },
    }),
    async () => true,
  );
  return {
    workspace,
    captures,
    scope,
    at,
    intent: (id: string) => ({
      id,
      key: "takeoffs.partition",
      kind: "workflow" as const,
      actor: "human" as const,
      destination: { kind: "document" as const, ref: target },
      input: {
        zoneRegion: candidate.elementId,
        view: candidate.view,
        zoneName: "Reviewed zone",
        zoneGuid: candidate.guid,
      },
      bases: { captureId: capture.id, work: { key: scope, revision: 1 } },
    }),
  };
}
