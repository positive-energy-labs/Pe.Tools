// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, waitFor, within } from "@testing-library/react";
import { createMemoryHistory, createRouter, RouterContextProvider } from "@tanstack/react-router";
import { afterEach, beforeEach, expect, test, vi } from "vite-plus/test";
import { takeoffEditKey, workKey, workWriteSchema, takeoffsRouteState } from "@pe/agent-contracts";
import {
  HOST_RPC_BRIDGE_SESSION_HEADER,
  HOST_RPC_DOCUMENT_HEADER,
} from "@pe/host-contracts/operation-types";
import { Route as root } from "../routes/__root";
import { takeoffsRoute, takeoffAdapters } from "./graph-route";
import { TakeoffHostFixture } from "./host.fixture";
import type { TakeoffMount } from "./store";

// App chrome is outside this route proof and imports other routes mid-cutover.
vi.mock("../routes/__root", async () => {
  const { createRootRoute } = await import("@tanstack/react-router");
  return { Route: createRootRoute() };
});

let host: TakeoffHostFixture;
const releases: (() => void)[] = [];
beforeEach(() => {
  host = new TakeoffHostFixture();
  vi.stubGlobal("fetch", host.fetch);
  vi.stubGlobal("EventSource", host.source());
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(600);
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(1200);
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
});
afterEach(async () => {
  cleanup();
  for (const release of releases.splice(0)) release();
  await new Promise((resolve) => setTimeout(resolve, 450));
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
async function mounted(search: Record<string, string> = {}) {
  const wrap = vi.spyOn(takeoffAdapters, "wrap");
  const router = createRouter({
    routeTree: root.addChildren([takeoffsRoute]),
    history: createMemoryHistory({
      initialEntries: [
        `/takeoffs?${new URLSearchParams({ target: host.target.session, ...search })}`,
      ],
    }),
  });
  releases.push(router.history.subscribe(router.load));
  await router.load();
  const Component = takeoffsRoute.options.component!;
  const view = render(
    <RouterContextProvider router={router}>
      <Component />
    </RouterContextProvider>,
  );
  await view.findByLabelText("Situation");
  const owner = (): TakeoffMount => wrap.mock.calls.at(-1)![0];
  await waitFor(() =>
    expect(owner().readings.get(search.work ? "saved" : "snapshot").current).toBe(true),
  );
  if (!search.work) await waitFor(() => expect(owner().snapshot().work).not.toBeNull());
  return { view, router, owner, situation: within(view.getByLabelText("Situation")) };
}
const run = async (owner: () => TakeoffMount, verb: string, row?: unknown) => {
  let result: Awaited<ReturnType<ReturnType<TakeoffMount["control"]>["run"]>>;
  await act(async () => {
    result = await owner().control(verb, row).run();
  });
  return result!;
};
test("the mounted takeoff room edit captures its first baseline and undo restores exact Work", async () => {
  const before = structuredClone(host.doc);
  const { owner, view } = await mounted();
  const room = host.capture.snapshot.world.zones[0]!.rooms[0]!;
  const input = await waitFor(() => {
    const cell = view.container.querySelector<HTMLInputElement>('[data-column-key="people"] input');
    expect(cell).not.toBeNull();
    return cell!;
  });
  fireEvent.change(input, { target: { value: "4" } });
  fireEvent.blur(input);
  await waitFor(() =>
    expect(host.doc.edits[takeoffEditKey(room.guid, "people")]?.edit?.value).toBe(4),
  );
  expect(host.doc.bases[room.guid]?.name).toBe(room.name);
  expect(host.writes).toHaveLength(1);
  expect(owner().journals.get(workKey(host.key))?.read().undo).toHaveLength(1);
  fireEvent.keyDown(view.getByLabelText("Takeoffs route"), { key: "z", ctrlKey: true });
  await waitFor(() => expect(host.doc).toEqual(before));
  expect(host.writes[1]?.kind).toBe("restore");
});
test("adoption, detector verdicts and shape flags are single undoable Work verbs", async () => {
  const { owner } = await mounted();
  const zone = host.capture.snapshot.world.zones[0]!;
  const room = zone.rooms[0]!;
  room.elementId = 501;
  room.analysis = { ...room.analysis!, state: "current", hold: null };
  await act(async () => host.emit("takeoff-reading"));
  for (const [verb, input] of [
    ["adoption", { key: "view:101", choice: { checked: true, name: "Bedroom", systemTag: "SYS" } }],
    ["decide", { room: room.guid, flag: "review", verdict: "dismiss" }],
    ["flag", { zone: zone.zone.guid, shape: "shape-A" }],
  ] as const) {
    const before = structuredClone(host.doc);
    const result = await run(owner, verb, input);
    expect(result, `${verb}: ${JSON.stringify(result)}`).toMatchObject({ state: "done" });
    await act(async () => {
      await owner().restore("undo");
    });
    expect(host.doc).toEqual(before);
  }
});
test("kernel proposal take refuses a missing first-edit base, then preserves its exact suggestion through undo", async () => {
  const room = host.capture.snapshot.world.zones[0]!.rooms[0]!;
  const key = takeoffEditKey(room.guid, "people");
  host.doc = takeoffsRouteState.schema.parse({ edits: { [key]: { suggestion: { value: 3 } } } });
  const { owner } = await mounted();
  expect(await run(owner, "cell:edits.take", { segment: "edits", key })).toMatchObject({
    state: "refused",
    refusal: { message: expect.stringContaining("first room baseline") },
  });
  expect(host.writes).toEqual([]);
  await run(owner, "room", { id: room.guid, next: { people: 2 } });
  const before = structuredClone(host.doc);
  expect(await run(owner, "cell:edits.take", { segment: "edits", key })).toMatchObject({
    state: "done",
  });
  await act(async () => {
    await owner().restore("undo");
  });
  expect(host.doc).toEqual(before);
});
test("partition refuses a multi-zone press and dispatches the exact single-zone command", async () => {
  const { owner } = await mounted();
  const zones = host.capture.snapshot.world.zones;
  act(() => owner().view.setPage({ zones: zones.slice(0, 2).map((zone) => zone.zone.guid) }));
  expect(await run(owner, "partition")).toMatchObject({
    state: "refused",
    refusal: { message: expect.stringContaining("one zone at a time") },
  });
  expect(host.actions).toEqual([]);
  expect(await run(owner, "partition", { zone: zones[0]!.zone.guid })).toMatchObject({
    state: "done",
  });
  expect(host.actions[0]).toMatchObject({
    key: "takeoffs.partition",
    target: { kind: "document", ref: host.target },
    input: { zoneGuid: zones[0]!.zone.guid, zoneRegion: zones[0]!.zone.elementId },
  });
});
test("a capture stays read-only even while its original document is open", async () => {
  const { owner, view } = await mounted({ work: host.capture.id });
  await waitFor(() => expect(owner().snapshot().work).not.toBeNull());
  expect(view.getByText(/Archived takeoff/)).toBeTruthy();
  const room = host.capture.snapshot.world.zones[0]!.rooms[0]!;
  expect(await run(owner, "room", { id: room.guid, next: { people: 7 } })).toMatchObject({
    state: "refused",
  });
  expect(await run(owner, "refresh")).toMatchObject({ state: "refused" });
  expect(host.writes).toEqual([]);
  expect(host.actions).toEqual([]);
  expect(host.requests).toEqual([]);
});

test("saved capture text shows the bytes as stored, including invalid JSON", async () => {
  const { owner, view } = await mounted({ work: host.capture.id });
  act(() => owner().view.setPage({ fileText: true }));
  await waitFor(() =>
    expect(owner().readings.get("text").value).toEqual({
      path: "capture.json",
      text: "  { malformed source text\n",
    }),
  );
  expect(view.getByText("capture.json")).toBeTruthy();
  expect(host.writes).toEqual([]);
});
test("level, zone and room navigate by URL; native reads carry the exact document", async () => {
  const { owner, router } = await mounted({
    level: "Main",
    zone: "zone",
    room: "room",
    demo: "sync",
  });
  expect(owner().view.read().page).toMatchObject({ level: "Main", zone: "zone", room: "room" });
  expect(owner().view.read().page).not.toHaveProperty("demo");
  act(() => owner().view.setPage({ level: "Upper", zone: "", room: "" }, { history: "push" }));
  await waitFor(() => expect(router.state.location.search.level).toBe("Upper"));
  act(() => router.history.back());
  await waitFor(() => expect(owner().view.read().page.level).toBe("Main"));
  expect(await run(owner, "refresh")).toMatchObject({ state: "done", kind: "query" });
  const request = host.requests.find((request) => request.key === "takeoffs.snapshot")!;
  expect(request.headers.get(HOST_RPC_BRIDGE_SESSION_HEADER)).toBe(host.target.session);
  expect(request.headers.get(HOST_RPC_DOCUMENT_HEADER)).toBe(host.target.openId);
  act(() => owner().view.setPage({ r10: "C:/Fixtures/retry.r10" }));
  expect(await run(owner, "retry-r10")).toMatchObject({ state: "done", kind: "query" });
  expect(host.requests.find((request) => request.key === "rhvac.open")?.request).toEqual({
    path: "C:/Fixtures/retry.r10",
  });
  expect(await run(owner, "launch")).toMatchObject({ state: "refused" });
  expect(host.requests.some((request) => request.key === "rhvac.launch")).toBe(false);
});

function syncReady() {
  const zone = host.capture.snapshot.world.zones[0]!;
  zone.driftSqft = 0;
  zone.runs = [];
  zone.tags = ["SYS"];
  zone.rooms = zone.rooms.slice(0, 1);
  const room = zone.rooms[0]!;
  room.elementId = 501;
  room.r10 = null;
  room.flags = [];
  room.analysis = { ...room.analysis!, state: "current", hold: null };
  room.data = { people: 1, lightingW: 10, equipSensible: 0, equipLatent: 0, ventilationCfm: 0 };
  return zone;
}
async function syncMounted() {
  const zone = syncReady();
  const mountedRoute = await mounted();
  act(() =>
    mountedRoute
      .owner()
      .view.setPage({ stage: "sync", zones: [zone.zone.guid], r10: "C:/Fixtures/example.r10" }),
  );
  await waitFor(() =>
    expect(mountedRoute.owner().readings.get("rhvacVersion").value).toMatchObject({
      fileVersion: "version-A",
    }),
  );
  return {
    ...mountedRoute,
    situation: within(mountedRoute.view.getByLabelText("Situation")),
    zone,
  };
}
test("sync reviews the frozen scope in the kernel before dispatching its native command", async () => {
  const { owner, situation, zone } = await syncMounted();
  fireEvent.click(situation.getByRole("button", { name: "sync" }));
  await waitFor(() => expect(owner().results.get("sync")).toMatchObject({ state: "review" }));
  const review = situation.getByLabelText("sync review");
  expect(review.textContent).toContain(host.capture.id);
  expect(review.textContent).toContain("version-A");
  expect(host.actions).toEqual([]);
  fireEvent.click(situation.getByRole("button", { name: "sync" }));
  await waitFor(() => expect(host.actions).toHaveLength(1));
  expect(host.actions[0]).toMatchObject({
    key: "takeoffs.sync",
    input: {
      captureId: host.capture.id,
      fileVersion: "version-A",
      zones: [zone.zone.guid],
      path: "C:/Fixtures/example.r10",
    },
  });
});
test.each(["Work", "capture", "file"] as const)(
  "changed %s refuses a previously reviewed sync",
  async (changed) => {
    const { owner, zone } = await syncMounted();
    expect(await run(owner, "sync")).toMatchObject({ state: "review" });
    if (changed === "Work") {
      // Another author can change Work while this mount holds its review ticket.
      await act(async () => {
        await host.write(
          workWriteSchema.parse({
            expectedRevision: host.revision,
            press: "other-author",
            patches: [
              {
                path: ["reviewFlags", JSON.stringify([zone.zone.guid, "shape-A"]), "edit"],
                value: { value: true },
              },
            ],
          }),
        );
      });
      await waitFor(() => expect(owner().snapshot().work?.handle.revision).toBe(2));
    } else
      await act(async () => {
        if (changed === "capture") {
          host.capture.id = "1".repeat(64);
          host.emit("takeoff-reading");
        } else {
          host.fileVersion = "version-B";
          host.emit("rhvac-file-version");
        }
      });
    expect(await run(owner, "sync")).toMatchObject({ state: "stale" });
    expect(host.actions).toEqual([]);
  },
);
test("an owner-crop refusal names the affected zones and prevents the native image request", async () => {
  host.ownerCrop = "Outside";
  const { owner } = await mounted();
  await waitFor(() => expect(owner().readings.get("plan").current).toBe(true));
  expect(owner().readings.get("plan").value).toMatchObject({
    image: null,
    note: expect.stringContaining("outside"),
  });
  expect(host.requests.some((request) => request.key === "revit.context.view-image")).toBe(false);
});
