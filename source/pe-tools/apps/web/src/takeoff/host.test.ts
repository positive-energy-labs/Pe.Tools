import { beforeEach, expect, test, vi } from "vite-plus/test";

import type { WorldRoom, WorldZone } from "#/takeoff/world";

const callHostRpc = vi.hoisted(() => vi.fn());
vi.mock("#/host/client", () => ({ callHostRpc }));

import { createLiveTakeoffHost } from "./host";

const room = (ceilingFt: number): WorldRoom => ({
  guid: "room-guid",
  elementId: 42,
  name: "Named Room",
  type: "hall",
  sqft: 100,
  ceilingFt,
  label: [5, 5],
  flags: [],
  decisions: [],
  provenance: { runId: "run", sourceRoomId: "R01", sourceSqft: 100 },
  r10: null,
  data: { people: 0, lightingW: 0, equipSensible: 0, equipLatent: 0, ventilationCfm: 0 },
  outer: [
    [0, 0],
    [10, 0],
    [10, 10],
    [0, 10],
  ],
  holes: [],
});

const zone = { tags: ["FC-1"] } as WorldZone;
const session = { sessionId: "session" } as Parameters<
  ReturnType<typeof createLiveTakeoffHost>["syncRhvac"]
>[0];

beforeEach(() => {
  callHostRpc.mockReset();
  callHostRpc.mockImplementation((key: string) => {
    if (key === "rhvac.open")
      return Promise.resolve({ rooms: [], systems: [{ number: 7, name: "FC-1" }] });
    if (key === "rhvac.sync")
      return Promise.resolve({
        insertedRooms: [{ number: 1, identifier: 99 }],
        roomsBefore: 0,
        roomsAfter: 1,
        seedRoom: { action: "kept" },
        backupPath: null,
        fileIdentity: { fileName: "test.r10", stamp: "stamp" },
      });
    return Promise.resolve({});
  });
});

test("RHVAC sync rejects invalid room heights and preserves a positive height", async () => {
  const host = createLiveTakeoffHost();
  for (const height of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
    await expect(
      host.syncRhvac(session, "test.r10", [{ zone, room: room(height) }]),
    ).rejects.toThrow(/room 'Named Room' has invalid ceiling height/);
    expect(callHostRpc).not.toHaveBeenCalledWith(
      "rhvac.sync",
      expect.anything(),
      expect.anything(),
    );
    callHostRpc.mockClear();
  }

  await host.syncRhvac(session, "test.r10", [{ zone, room: room(9.5) }]);
  const request = callHostRpc.mock.calls.find(([key]) => key === "rhvac.sync")![1];
  expect(request.inserts[0].ceilingHeightFeet).toBe(9.5);
  expect(
    request.inserts[0].walls.every((wall: { heightFeet: number }) => wall.heightFeet === 9.5),
  ).toBe(true);
});
