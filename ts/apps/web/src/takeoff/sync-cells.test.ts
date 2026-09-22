/**
 * Sync consumes human-staged cells only (co-sign rules 1-3, Mission 10 obligation 4a): Pea's
 * proposed edit and proposed flag dismissal never reach the prepared sync, so the flag still
 * blocks and nothing is written; the person's staged dismissal unblocks it.
 */
import { afterEach, expect, test, vi } from "vite-plus/test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect } from "effect";
import {
  address,
  takeoffsRouteState,
  takeoffDecisionKey,
  takeoffEditKey,
  transitionPatches,
  type TakeoffSnapshot,
} from "@pe/agent-contracts";
import { manifest as takeoffManifest } from "#/takeoff/manifest";
import { RouteWorkspace } from "../../../../packages/runtime/src/route-workspace";
import { ActionJournal } from "../../../host/src/action-journal";
import { TakeoffCaptures } from "../../../host/src/takeoff-captures";
import { admitTakeoffAction } from "../../../host/src/takeoff-actions";
import { sdkSessions } from "../../../host/tests/native-receipt-fixture";
import type { RevitBridge } from "../../../host/src/bridge";

const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

async function syncFixture() {
  const root = await mkdtemp(join(tmpdir(), "pe-takeoff-sync-cells-"));
  roots.push(root);
  const seed = structuredClone(
    (
      takeoffManifest.seeds as unknown as Record<
        string,
        {
          page: { zones: string[] };
          readings: { snapshot: { capture: { snapshot: TakeoffSnapshot } } };
        }
      >
    ).sync!,
  );
  const snapshot = seed.readings.snapshot.capture.snapshot;
  const zone = snapshot.world.zones.find((candidate) => candidate.rooms.length > 0)!;
  zone.tags = ["AHU-1"];
  // A zone ready in every other way, with one flagged room: the flag is the only gate.
  zone.driftSqft = 0;
  zone.runs = [];
  for (const other of zone.rooms) {
    other.flags = [];
    other.analysis = { state: "current", runId: null, floorZ: 0, ceilingZ: 9, hold: null };
  }
  const room = zone.rooms[0]!;
  room.flags = ["seedless"];
  const at = address("C:\\Models\\projectA.rvt");
  const rows = new Map<string, unknown>();
  const work = new RouteWorkspace({
    registrations: [{ spec: takeoffsRouteState as never, handlers: {} }],
    store: {
      getState: async ({ targetKey, route }) => structuredClone(rows.get(targetKey + route)),
      setState: async ({ targetKey, route, value }) =>
        void rows.set(targetKey + route, structuredClone(value)),
    },
  });
  const captures = new TakeoffCaptures(join(root, "captures"));
  const owner = {
    id: "sync-cells",
    at,
    target: { session: "A", openId: "open-A" },
    scope: { route: "takeoffs", target: at },
    work,
    captures,
    journal: new ActionJournal(join(root, "actions.json")),
  };
  const capture = await owner.captures.refresh(
    owner.target,
    async () => ({
      result: null,
      snapshot: { ...snapshot, reading: { ...snapshot.reading, at: owner.at } },
    }),
    async () => true,
  );
  const bridge = {
    list: Effect.succeed([
      {
        sessionId: owner.target.session,
        processId: 42,
        processStartUtcUnixMs: 1000,
        state: {
          openDocuments: [
            { openId: owner.target.openId, address: owner.at, isFamilyDocument: false },
          ],
        },
      },
    ]),
    invoke: () => Effect.sync(() => ({ value: {}, target: null })),
  } as unknown as RevitBridge["Service"];
  const syncFile = vi.fn(async () => ({
    insertedRooms: [],
    updated: 0,
    fileIdentity: { fileName: "projectA.r10", stamp: "s" },
  }));
  const deps = {
    workspace: owner.work,
    sdk: sdkSessions,
    fileVersion: async () => "v1",
    openFile: async () => ({
      rooms: [{ number: 1, name: "", areaSquareFeet: 0, identifier: 1 }],
      systems: [{ number: 1, name: "AHU-1" }],
    }),
    syncFile,
  };
  const write = async (actor: "agent" | "human", patches: unknown[]) => {
    const revision = (await owner.work.read(owner.scope, "takeoffs"))?.revision ?? 0;
    const landed = await owner.work.apply(
      owner.scope,
      "takeoffs",
      actor,
      patches as never,
      revision,
    );
    expect(landed, JSON.stringify(landed)).toMatchObject({ ok: true });
  };
  let serial = 0;
  const sync = async () => {
    const revision = (await owner.work.read(owner.scope, "takeoffs"))?.revision ?? 0;
    const id = `${owner.id}:sync-${++serial}`;
    await admitTakeoffAction(
      {
        id,
        kind: "workflow",
        key: "takeoffs.sync",
        actor: "agent",
        destination: { kind: "document", ref: owner.target },
        input: { path: "C:\\Fixtures\\projectA.r10", zones: [zone.zone.guid] },
        bases: {
          captureId: capture.capture.id,
          fileVersion: "v1",
          work: { key: owner.scope, revision },
        },
      } as never,
      owner.journal,
      owner.captures,
      bridge,
      deps as never,
    );
    return owner.journal.wait(id);
  };
  return { room, write, sync, syncFile };
}

test("Pea's proposed edit and dismissal never reach sync: the flag still blocks and nothing moves", async () => {
  const f = await syncFixture();
  const edit = takeoffEditKey(f.room.guid, "name");
  const decision = takeoffDecisionKey(f.room.guid, "seedless");
  await f.write("agent", [
    ...transitionPatches(["edits"], edit, {}, { kind: "propose", rung: { value: "Pea name" } }),
    ...transitionPatches(
      ["decisions"],
      decision,
      {},
      {
        kind: "propose",
        rung: { value: "dismiss" },
      },
    ),
  ]);
  const refused = await f.sync();
  expect(refused.state).toBe("failed");
  expect(JSON.stringify(refused)).toContain("not ready to sync");
  expect(f.syncFile).not.toHaveBeenCalled();

  // The person stages the dismissal: now the flag no longer blocks.
  await f.write(
    "human",
    transitionPatches(["decisions"], decision, {}, { kind: "stage", rung: { value: "dismiss" } }),
  );
  const synced = await f.sync();
  expect(JSON.stringify(synced)).not.toContain("not ready to sync");
  // What sync froze: the person's staged verdict, and none of Pea's proposed edit.
  expect(synced.preparation).toMatchObject({
    state: "ready",
    value: { edits: {}, decisions: { [decision]: "dismiss" } },
  });
});
