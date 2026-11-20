/**
 * The commands of the product over the recorded native boundary. Work, the action registry,
 * consent, the journal and the executors are production; only native replies are recordings.
 */
import { rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect } from "effect";
import { expect, test } from "vite-plus/test";
import { RouteWorkspace } from "@pe/runtime";
import { address } from "@pe/agent-contracts";
import {
  stagedTakeoffEdits,
  takeoffEditKey,
  takeoffObservationSchema,
} from "@pe/rooms-contract/takeoffs";
import { demoSeedCodec } from "@pe/rooms-host/tests/demo-seed";
import { landings } from "@pe/agent-contracts/product";
import { product, regionCode, roomsWork, takeoffsWork } from "@pe/rooms-contract/product";
import { mkdtemp } from "../../../../tests/isolated-home/storage.ts";
import { bindCommandRuntime } from "../../src/command-registry.ts";
import { bindControl } from "../../src/control.ts";
import { fileVersion } from "@pe/host-internal/local-files";
import {
  captureStore,
  settle,
  testDocumentMarks,
  testDuctFiles,
  testRegistry,
} from "../effect-test.ts";
import { fixtureNative } from "../fixture-native.ts";
import { withRoomsSheet } from "@pe/rooms-host/tests/rooms-sheet";
import { sdkSessions } from "../native-receipt-fixture.ts";
import { nativeRecordingRequest } from "../native-recordings.ts";
import syncSeed from "./fixtures/sync-seed.json" with { type: "json" };

const { commands } = product;
const works = { rooms: roomsWork, takeoffs: takeoffsWork };
test("Takeoffs demo seeds round-trip edits through the declared Work", () => {
  const observation = takeoffObservationSchema.parse(syncSeed.snapshot);
  if (observation.kind !== "ready") throw Error("Expected a saved snapshot seed");
  const at = address("C:/model.rvt");
  const codec = demoSeedCodec(takeoffsWork);
  const edit = takeoffEditKey("room-1", "name");
  const seed = codec.importSeed(
    codec.exportSeed({
      version: 1,
      namespace: "isolated-demo",
      route: "takeoffs",
      seedAddress: at,
      failure: { kind: "none" },
      originalEvidence: null,
      work: {
        key: { binding: "address", route: takeoffsWork.route, target: at },
        revision: 0,
        candidate: { edits: { [edit]: { edit: { by: "human", value: "Reviewed room" } } } },
      },
      readings: { snapshot: observation.capture.snapshot, candidates: [] },
      page: { views: [], zones: [], dir: "", r10: "", stage: "sync" },
      files: [],
    }),
  );
  if (seed.route !== "takeoffs") throw Error("Expected a Takeoffs seed");
  expect(stagedTakeoffEdits(seed.work.candidate)).toEqual({
    "room-1": { roomId: "room-1", next: { name: "Reviewed room" } },
  });
});
const recordedInput = (name: string) =>
  Object.fromEntries(
    Object.entries(nativeRecordingRequest(name)).filter(([, value]) => value !== null),
  );
const recordedRoomWrites = nativeRecordingRequest("fresh-rooms.write").regions as {
  uniqueId: string;
  name: string;
}[];
test("JZ recorded bridge rejects obsolete native DTOs behind actual Adopt admission", async () => {
  const dir = await mkdtemp(join(tmpdir(), "jz-recording-schema-"));
  const native = await fixtureNative(join(dir, "native"), "manuella-adopt");
  const socket = await native.connect();
  let state: unknown;
  const workspace = new RouteWorkspace({
    publicationAuthor: () => "human",
    registrations: [{ spec: takeoffsWork }],
    store: {
      getState: async () => state,
      setState: async ({ value }) => {
        state = structuredClone(value);
      },
    },
  });
  const key = { binding: "address" as const, route: "takeoffs", target: address("C:/model.rvt") };
  const post = native.actions({ workspace, marks: testDocumentMarks(native.bridge) });
  try {
    await workspace.publish(
      key,
      "takeoffs",
      [
        {
          path: ["writeIntent", "takeoffs.adopt"],
          value: { edit: { value: { views: [recordedInput("fresh-takeoffs.adopt")] } } },
        },
      ],
      0,
    );
    const input = { work: { key, revision: 1 } };
    for (const [id, command] of [
      ["preview", "takeoffs.adopt.preview"],
      ["apply", "takeoffs.adopt"],
    ]) {
      const response = await post({
        id,
        key: command,
        target: { kind: "document", ref: socket.target },
        input,
      });
      expect(response.status, await response.clone().text()).toBeLessThan(400);
      const receipt = await native.journal.wait(id!);
      if (id === "preview") expect(receipt.state).toBe("succeeded");
      else {
        expect(receipt.state).toBe("incomplete");
        expect(JSON.stringify(receipt)).toContain("adopted");
        expect(JSON.stringify(receipt)).toContain("array");
      }
    }
    expect(native.calls.map((call) => call.key)).toEqual(["takeoffs.adopt"]);
  } finally {
    await native.close();
    await rm(dir, { recursive: true, force: true });
  }
});

// The product names the rooms to merge by SubjectRef; the native leaf takes their UniqueIds.
const { uniqueIds, ...merge } = recordedInput("fresh-rooms.merge");
const mergeIntent = { ...merge, regions: (uniqueIds as string[]).map(regionCode) };
test.each([
  ["takeoffs.adopt", { views: [recordedInput("fresh-takeoffs.adopt")] }],
  ["takeoffs.partition", recordedInput("fresh-takeoffs.partition")],
  ["rooms.partition", recordedInput("fresh-rooms.partition")],
  ["rooms.draw", recordedInput("fresh-rooms.draw")],
  // The field write is the platform sheet pair, bound to the Rooms body.
  ["sheet.apply", {}],
  ["rooms.merge", mergeIntent],
  ["takeoffs.sync", {}],
] as const)(
  "JZ record commands run real declarations and guarded native dispatch: %s",
  async (commandKey, intent) => {
    const dir = await mkdtemp(join(tmpdir(), "jz-takeoffs-leaf-"));
    const route = commandKey.startsWith("takeoffs.") ? "takeoffs" : "rooms";
    const key = { binding: "address" as const, target: address("C:/model.rvt"), route };
    let saved: unknown;
    const workspace = withRoomsSheet(
      new RouteWorkspace({
        publicationAuthor: () => "human",
        registrations: [{ spec: works[route] }],
        store: {
          getState: async () => saved,
          setState: async ({ value }) => {
            saved = structuredClone(value);
          },
        },
      }),
    );
    const native = await fixtureNative(
      join(dir, "native"),
      "fresh-takeoffs.adopt",
      "fresh-takeoffs.partition",
      "fresh-rooms.partition",
      "fresh-rooms.draw",
      "fresh-rooms.write",
      "fresh-rooms.merge",
      "fresh-takeoffs.rhvac-links",
    );
    native.reportTrackedRooms(recordedRoomWrites.map(({ uniqueId }) => uniqueId));
    const socket = await native.connect();
    const { calls } = native;
    const ref = socket.target;
    const path = address("C:/model.rvt");
    const { bridge, journal } = native;
    const runs = testRegistry();
    bindControl({ runs, acquired: () => null });
    const captures = captureStore(dir);
    const identity = {
      fileName: "recorded.r10",
      projectTitle: "Journey",
      clientName: "",
      stamp: "recorded",
    };
    let synced = false;
    const deps: Parameters<typeof bindCommandRuntime>[3] = {
      workspace,
      sdk: sdkSessions,
      files: testDuctFiles(),
      marks: testDocumentMarks(bridge),
      openFile: async (file) => ({
        sourceFile: file,
        fileIdentity: identity,
        building: {},
        systems: [{ number: 1, name: "SA1" }],
        rooms: [],
      }),
      syncFile: async (input) => {
        expect(input.inserts?.map(({ name }) => name)).toEqual(["Reviewed room"]);
        synced = true;
        return {
          targetPath: input.targetPath,
          backupPath: null,
          swapped: true,
          fileIdentity: identity,
          insertedRooms: (input.inserts ?? []).map((room) => ({
            number: room.number,
            name: room.name,
            identifier: room.number + 100,
          })),
          updated: 0,
          systems: [],
          seedRoom: { identifier: 0, action: "not-requested", reason: "recorded adapter" },
          assemblyFallbacks: [],
          roomsBefore: 0,
          roomsAfter: input.inserts?.length ?? 0,
          log: "recorded adapter",
        };
      },
    };
    const post = native.actions(deps, captures);
    const invoke = async (key: string, input: Record<string, unknown>) => {
      const id = `${key}-${(await journal.list()).length}`;
      const response = await post({ id, key, target: { kind: "document", ref }, input });
      expect([200, 202], await response.clone().text()).toContain(response.status);
      const receipt = await journal.wait(id);
      expect(receipt.state, JSON.stringify(receipt)).toBe("succeeded");
      return receipt;
    };
    try {
      let authored: Record<string, unknown> = intent;
      let editKey: string | undefined;
      if (commandKey === "takeoffs.sync") {
        const recorded = takeoffObservationSchema.parse(syncSeed.snapshot);
        if (recorded.kind !== "ready") throw Error("Expected a saved snapshot seed");
        const snapshot = structuredClone(recorded.capture.snapshot);
        snapshot.reading.at = path;
        const zone = snapshot.world.zones[0]!;
        const room = zone.rooms.find((room) => room.data !== null)!;
        editKey = takeoffEditKey(room.guid, "name");
        zone.rooms = [room];
        zone.tags = ["SA1"];
        zone.driftSqft = 0;
        zone.runs = [];
        room.r10 = null;
        room.elementId = 21;
        room.flags = [];
        room.analysis = { state: "current", hold: null, runId: null, floorZ: null, ceilingZ: null };
        snapshot.world.zones = [zone];
        const retained = await settle(
          captures.refresh(ref, Effect.succeed({ result: null, snapshot }), Effect.succeed(true)),
        );
        const file = join(dir, "recorded.r10");
        await writeFile(file, "recorded RHVAC transport input", "utf8");
        authored = {
          path: file,
          captureId: retained.capture.id,
          fileVersion: await fileVersion(file),
          zones: [zone.zone.guid],
        };
      }
      const edits =
        commandKey === "sheet.apply"
          ? recordedRoomWrites.map((room) => ({
              path: ["name", regionCode(room.uniqueId)],
              value: { edit: { value: room.name } },
            }))
          : [];
      await workspace.publish(
        key,
        route,
        commandKey === "sheet.apply"
          ? edits
          : [
              { path: ["writeIntent", commandKey], value: { edit: { value: authored } } },
              ...(editKey
                ? [{ path: ["edits", editKey], value: { edit: { value: "Reviewed room" } } }]
                : []),
            ],
        0,
      );
      const work = { key, revision: (await workspace.read(key, route))!.revision };
      if (commandKey === "sheet.apply") {
        expect(await invoke("sheet.plan", { work })).toMatchObject({
          result: { previewOnly: true },
        });
        expect(calls, "A plan never dispatches a record mutation").toEqual([]);
      } else if ("writeBoundary" in commands[commandKey]) {
        const definition = commands[commandKey];
        const plan = await invoke(definition.writeBoundary.previewKey, { work });
        expect(plan).toMatchObject({ result: { previewOnly: true } });
        expect(calls, "A plan never dispatches a record mutation").toEqual([]);
      }
      await invoke(commandKey, { work });
      if (commandKey === "takeoffs.sync") {
        expect(synced).toBe(true);
        expect(landings(product).edits).toBe("r10");
        const current = takeoffsWork.schema.parse((await workspace.read(key, route))!.doc);
        expect(stagedTakeoffEdits(current)).toEqual({});
        const write = (link: object) => ({
          action: commandKey,
          input: {
            writes: [
              {
                elementId: 21,
                uniqueId: expect.any(String),
                link: expect.objectContaining(link),
              },
            ],
          },
        });
        // The link write is rehearsed with a placeholder before the file is touched, then written.
        expect(calls).toEqual([
          {
            key: "takeoffs.rhvac-links.preflight",
            ...write({ identifier: -2147483648, fileIdentity: `recorded.r10#${"0".repeat(16)}` }),
          },
          {
            key: "takeoffs.rhvac-links",
            ...write({ identifier: 101, fileIdentity: "recorded.r10#recorded" }),
          },
        ]);
        return;
      }
      if (commandKey === "rooms.partition") {
        expect(calls).toEqual([
          {
            key: commandKey,
            action: commandKey,
            input: { ...authored, runId: expect.any(String) },
          },
        ]);
        return;
      }
      expect(calls.map((row) => row.key)).toEqual([
        commandKey === "sheet.apply" ? "rooms.write" : commandKey,
      ]);
      if (commandKey === "sheet.apply") {
        expect(calls[0]).toEqual({
          key: "rooms.write",
          action: commandKey,
          input: { regions: recordedRoomWrites.map(({ uniqueId, name }) => ({ uniqueId, name })) },
        });
        const current = roomsWork.schema.parse((await workspace.read(key, route))!.doc);
        for (const { uniqueId } of recordedRoomWrites)
          expect(current.name[regionCode(uniqueId)]?.edit ?? null).toBeNull();
      }
    } finally {
      await native.close();
      runs.closeAll();
      bindControl({ runs: undefined });
      await rm(dir, { recursive: true, force: true });
    }
  },
  60_000,
);
