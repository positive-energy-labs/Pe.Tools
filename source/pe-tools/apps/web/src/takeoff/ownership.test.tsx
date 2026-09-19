// @vitest-environment jsdom
import { takeoffDecisionKey } from "@pe/agent-contracts";
import { afterEach, expect, test, vi } from "vite-plus/test";
import { act, cleanup, renderHook } from "@testing-library/react";
import { address, type TakeoffObservation, type WorkKey } from "@pe/agent-contracts";
import { useTakeoffsController } from "./controller";
import { manifest } from "./manifest";
import { syncPlan, takeoffSeeds } from "./actions";

class DeadSource {
  close() {}
  addEventListener() {}
  removeEventListener() {}
}
(globalThis as { EventSource?: unknown }).EventSource = DeadSource;
afterEach(() => {
  cleanup();
  history.replaceState(null, "", "/");
});

test("sync review applies staged values and treats Work decisions as resolved", () => {
  const capture = (
    takeoffSeeds.sync.readings.snapshot as Extract<TakeoffObservation, { kind: "ready" }>
  ).capture;
  const zone = structuredClone(capture.snapshot.world.zones.find((item) => item.rooms.length)!);
  const room = zone.rooms[0]!;
  zone.driftSqft = 0;
  zone.runs = [];
  zone.rooms = [
    {
      ...room,
      elementId: room.elementId ?? 1,
      flags: ["check"],
      analysis: {
        state: "current",
        runId: "run",
        floorZ: 0,
        ceilingZ: 9,
        hold: null,
      },
      r10: null,
      data: room.data ?? {
        people: 1,
        lightingW: 1,
        equipSensible: 1,
        equipLatent: 1,
        ventilationCfm: 1,
      },
    },
  ];
  const plan = syncPlan(
    { ...capture.snapshot.world, zones: [zone] },
    [zone.zone.guid],
    {
      [room.guid]: {
        roomId: room.guid,
        base: { name: room.name },
        next: { name: "Reviewed room", people: 7 },
      },
    },
    { [takeoffDecisionKey(room.guid, "check")]: "accept" },
  );

  expect(plan.blockedZones).toEqual([]);
  expect(plan.inserts[0]!.room).toMatchObject({ name: "Reviewed room", data: { people: 7 } });
});

test("standalone navigation delegates to its URL owner instead of copying fields into Page", () => {
  const set = vi.fn();
  const { result } = renderHook(() =>
    useTakeoffsController({
      navigation: { value: { level: "Level 2", zone: "zone-guid", room: "room-guid" }, set },
    }),
  );

  expect(result.current.level).toBe("Level 2");
  expect(result.current.zoneKey).toBe("zone-guid");
  expect(result.current.cursor).toBe("room-guid");
  expect(result.current.handle.page[0]).not.toHaveProperty("level");
  act(() => result.current.actions.chooseLevel("Level 1"));
  expect(set).toHaveBeenCalledWith({ level: "Level 1", zone: null, room: null });
});

test("workspace selections update Page while a frozen seed refuses mutation", () => {
  history.replaceState(null, "", "/takeoffs?demo=sync");
  const { result } = renderHook(() => useTakeoffsController({}));
  act(() => {
    result.current.actions.chooseZones([]);
    result.current.actions.chooseR10("");
  });
  expect(result.current.handle.page[0].zones).toEqual([]);
  expect(result.current.handle.actions.partition.refusal).toBe("frozen seed is read-only");
  expect(result.current.handle.actions.sync.refusal).toBe("frozen seed is read-only");
  act(() => result.current.actions.chooseR10("C:\\Fixtures\\projectA.r10"));
  expect(result.current.handle.actions.sync.refusal).toBe("frozen seed is read-only");
  act(() =>
    result.current.handle.page[1]({
      syncReview: {
        target: { session: "wrong-session", openId: "wrong-document" },
        work: {
          key: result.current.handle.work.key,
          revision: result.current.handle.work.revision!,
        },
        captureId: "wrong-capture",
        fileVersion: "reviewed-version",
        path: result.current.r10Path,
        zones: result.current.zones,
      },
    }),
  );
  expect(result.current.handle.actions["commit-sync"].refusal).toBe("frozen seed is read-only");
  act(() => result.current.actions.openPanel(null));
  expect(result.current.handle.page[0].panel).toBeNull();
  expect(result.current.syncReview).toBeNull();
});

test("the controller prunes dependent scope and the live manifest has no saved-fixture reading", () => {
  history.replaceState(null, "", "/takeoffs?demo=partition");
  const { result } = renderHook(() => useTakeoffsController({}));
  const view = result.current.world.lanes[0]!.view;
  const focused = result.current.world.zones[0]!;

  act(() => result.current.actions.chooseZones([]));
  act(() => result.current.actions.openPanel("sync"));
  act(() => result.current.actions.chooseZone(focused.zone.guid, focused.zone.lane.label));
  expect(result.current.zones).toEqual([focused.zone.guid]);
  expect(result.current.panel).toBeNull();
  expect(result.current.handle.actions.partition.count).toBeNull();
  expect(result.current.handle.actions.partition.refusal).toBe("frozen seed is read-only");

  act(() => result.current.actions.chooseLevel("another level"));
  expect(result.current.zoneKey).toBeNull();
  expect(result.current.cursor).toBeNull();

  act(() => result.current.actions.chooseViews([view]));
  expect(result.current.zones.length).toBeGreaterThan(0);
  expect(
    result.current.world.zones
      .filter((zone) => result.current.zones.includes(zone.zone.guid))
      .every((zone) => zone.zone.lane.view === view),
  ).toBe(true);

  act(() => result.current.actions.resetTarget());
  expect(result.current.handle.page[0]).toMatchObject({
    views: [],
    zones: [],
    r10: "",
    stage: "adopt",
    stageFilter: null,
  });
  expect(result.current.level).toBe("");
  expect(result.current.zoneKey).toBeNull();
  expect(result.current.cursor).toBeNull();
  expect(manifest.readings).not.toHaveProperty("saved");
  expect(manifest.actions?.adopt.requires).toEqual({ work: true, readings: ["snapshot"] });
  expect(manifest.actions?.["commit-sync"].requires).toEqual({
    work: true,
    readings: ["snapshot", "rhvacVersion"],
  });
  expect(manifest.readings?.receipts).toEqual({
    kind: "receipts",
    target: { session: "", openId: "" },
  });
  const versionRequest = manifest.readings?.rhvacVersion;
  expect(versionRequest).toBeTypeOf("function");
  if (typeof versionRequest === "function") {
    const work = {
      route: "takeoffs",
      target: address("C:\\Models\\projectA.rvt"),
    } satisfies WorkKey;
    expect(versionRequest(manifest.page!.parse({}), work)).toBeNull();
    expect(versionRequest(manifest.page!.parse({ r10: "C:\\Projects\\Other.r10" }), work)).toEqual({
      kind: "rhvac-file-version",
      path: "C:\\Projects\\Other.r10",
    });
  }
});
