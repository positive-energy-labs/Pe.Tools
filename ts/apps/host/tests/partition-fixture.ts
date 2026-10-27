import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  address,
  takeoffsRouteState,
  type DocumentRef,
  takeoffEditPatches,
} from "@pe/agent-contracts";
import { RouteWorkspace } from "../../../packages/runtime/src/route-workspace.ts";
import { TakeoffCaptures } from "../src/takeoff-captures.ts";
export async function partitionFixture(dir: string, target: DocumentRef) {
  const at = address("C:/model.rvt");
  const scope = { binding: "address" as const, route: "takeoffs", target: at };
  const workFile = join(dir, "work.json");
  const workspace = new RouteWorkspace({
    registrations: [{ spec: takeoffsRouteState }],
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
    takeoffEditPatches(
      takeoffsRouteState.schema.parse({}),
      "room-1",
      { name: "Before" },
      { name: "Reviewed" },
    ),
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
      target: { kind: "document" as const, ref: target },
      input: {
        work: { key: scope, revision: 1 },
        captureId: capture.id,
        zoneRegion: candidate.elementId,
        view: candidate.view,
        zoneName: "Reviewed zone",
        zoneGuid: candidate.guid,
      },
    }),
  };
}
