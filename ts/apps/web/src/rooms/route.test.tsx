// @vitest-environment jsdom
import { activityTime } from "#/shell/timeline";
import { roomEditKey, roomsRouteState, workKey } from "@pe/agent-contracts";
import { createMemoryHistory, createRouter, RouterContextProvider } from "@tanstack/react-router";
import { act, cleanup, fireEvent, render, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vite-plus/test";
import { Route as root } from "../routes/__root";
import { DEMO_VIEW } from "./demo";
import { RoomsHostFixture } from "./host.fixture";
import { roomsAdapters, roomsRoute, RoomsRoute } from "./route";

// The app registry is another wave's cutover; this mounts the actual graph under a router root.
vi.mock("../routes/__root", async () => {
  const { createRootRoute } = await import("@tanstack/react-router");
  return { Route: createRootRoute() };
});
let host: RoomsHostFixture;
const releases: (() => void)[] = [];
beforeEach(() => {
  host = new RoomsHostFixture();
  vi.stubGlobal("EventSource", host.source());
  vi.stubGlobal("fetch", host.fetch);
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
});
afterEach(async () => {
  cleanup();
  for (const release of releases.splice(0)) release();
  await new Promise((resolve) => setTimeout(resolve, 450));
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
async function mounted(search: Record<string, string> = {}, hosted = false) {
  const wrap = vi.spyOn(roomsAdapters, "wrap");
  const url = `/rooms?${new URLSearchParams({ target: host.target.session, view: DEMO_VIEW, stage: "review", ...search })}`;
  const router = createRouter({
    routeTree: root.addChildren([roomsRoute]),
    history: createMemoryHistory({ initialEntries: [url] }),
  });
  releases.push(router.history.subscribe(router.load));
  await router.load();
  const Component = roomsRoute.options.component!;
  const view = render(
    <RouterContextProvider router={router}>
      {hosted ? (
        <RoomsRoute url={false} thread="hosted-room-thread" target={host.target.session} />
      ) : (
        <Component />
      )}
    </RouterContextProvider>,
  );
  await view.findByLabelText("Situation");
  await waitFor(() => expect(wrap.mock.calls.at(-1)?.[0].snapshot().work).not.toBeNull());
  const owner = () => wrap.mock.calls.at(-1)![0];
  await waitFor(() => expect(owner().readings.get("snapshot").current).toBe(true));
  return { view, router, owner, situation: within(view.getByLabelText("Situation")) };
}
const liveButton = (scope: ReturnType<typeof within>, name: string) =>
  waitFor(() => {
    const button = scope.getByRole("button", { name });
    expect(button.getAttribute("aria-disabled")).not.toBe("true");
    return button;
  });

test("the rooms URL restores layers, selection, filter and viewport without staging Work", async () => {
  const { router, view } = await mounted({
    layers: "rails,faces",
    selected: "card:m1",
    show: "accepted",
    viewport: "plane:2,10,20",
  });
  expect(router.state.location.search).toMatchObject({
    layers: "rails,faces",
    selected: "card:m1",
    show: "accepted",
    viewport: "plane:2,10,20",
  });
  expect(view.getByRole("button", { name: "apply" }).getAttribute("aria-disabled")).toBe("true");
  expect(host.writes).toEqual([]);
  expect(host.actions).toEqual([]);
});

test("editing a real table cell makes one journal step and Mod+Z restores exact Work", async () => {
  const before = structuredClone(host.doc);
  const { view, owner } = await mounted();
  const input = await waitFor(() => {
    const row = view.container.querySelector(
      'tr[data-subject="room:00000000-0000-4000-8000-000000000001"]',
    );
    const input = row?.querySelector<HTMLInputElement>("input");
    expect(input).toBeTruthy();
    return input!;
  });
  fireEvent.change(input, { target: { value: "Pantry" } });
  fireEvent.keyDown(input, { key: "Enter" });
  await waitFor(() =>
    expect(
      host.doc.edits[roomEditKey("00000000-0000-4000-8000-000000000001", "name")]?.edit?.value,
    ).toBe("Pantry"),
  );
  expect(host.writes).toHaveLength(1);
  expect(owner().journals.get(workKey(host.key))!.read().undo).toHaveLength(1);
  await waitFor(() => {
    expect(owner().snapshot().work?.handle.revision).toBe(host.revision);
    expect(owner().journal(host.key).read().busy).toBe(false);
  });
  fireEvent.keyDown(view.getByLabelText("Rooms route"), { key: "z", ctrlKey: true });
  await waitFor(() => expect(host.writes).toHaveLength(2));
  expect(host.doc).toEqual(before);
  expect(host.writes[1]!.kind).toBe("restore");
});

test("returning window focus re-reads rooms without exporting the expensive plan again", async () => {
  const { owner } = await mounted();
  const reads = host.calls.filter((row) => row.key === "rooms.snapshot").length;
  const images = host.calls.filter((row) => row.key === "revit.context.view-image").length;
  await act(async () => {
    window.dispatchEvent(new Event("focus"));
  });
  await waitFor(() =>
    expect(host.calls.filter((row) => row.key === "rooms.snapshot")).toHaveLength(reads + 1),
  );
  await waitFor(() => expect(owner().readings.get("snapshot").current).toBe(true));
  expect(host.calls.filter((row) => row.key === "revit.context.view-image")).toHaveLength(images);
});

test("fixture reads never call a native operation and every native write is refused", async () => {
  const { view, situation } = await mounted({ fixture: "plan" });
  await view.findByRole("grid", { name: "room regions" });
  expect(host.calls).toEqual([]);
  expect(situation.getByRole("button", { name: "apply" }).getAttribute("aria-disabled")).toBe(
    "true",
  );
  expect(host.actions).toEqual([]);
});

test("kernel mark take, reopen, reject and delete each undo to the exact prior cell", async () => {
  const mark = {
    kind: "merge",
    anchor: {
      view: DEMO_VIEW,
      level: "Fixture level",
      polygon: [
        [0, 0],
        [40, 0],
        [40, 12],
        [0, 12],
      ],
    },
    run: "fixture-run",
    guids: ["00000000-0000-4000-8000-000000000001", "00000000-0000-4000-8000-000000000002"],
  };
  host.doc = roomsRouteState.schema.parse({ marks: { m1: { suggestion: { value: mark } } } });
  const { owner } = await mounted();
  const row = { segment: "marks", key: "m1" };
  const press = async (verb: string) => {
    await act(async () => {
      expect(await owner().control(`cell:marks.${verb}`, row).run()).toMatchObject({
        state: "done",
        kind: "work",
      });
    });
    await waitFor(() => expect(owner().snapshot().work?.handle.revision).toBe(host.revision));
  };
  const restore = async () => {
    await act(async () => {
      await owner().restore("undo");
    });
    await waitFor(() => expect(owner().snapshot().work?.handle.revision).toBe(host.revision));
  };
  const before = structuredClone(host.doc);
  await press("take");
  expect(host.doc.marks.m1?.edit?.value).toEqual(mark);
  await restore();
  expect(host.doc).toEqual(before);
  await press("reject");
  expect(host.doc.marks.m1?.suggestion).toBeNull();
  await restore();
  expect(host.doc).toEqual(before);
  await press("delete");
  expect(host.doc.marks.m1).toBeUndefined();
  await restore();
  expect(host.doc).toEqual(before);
  await press("take");
  const edited = structuredClone(host.doc);
  await press("reopen");
  expect(host.doc.marks.m1?.edit).toBeNull();
  await restore();
  expect(host.doc).toEqual(edited);
});

test("notes use a rungless delete verb and undo restores their anchor, text and authorship", async () => {
  host.doc = roomsRouteState.schema.parse({
    notes: {
      n1: {
        anchor: { view: DEMO_VIEW, level: "Fixture level", polygon: [[1, 2]] },
        text: "Keep this room",
        by: "person",
        at: "2026-10-29T22:00:00Z",
      },
    },
  });
  const before = structuredClone(host.doc);
  const { owner } = await mounted();
  await act(async () => {
    expect(await owner().control("delete-note", { id: "n1" }).run()).toMatchObject({
      state: "done",
      kind: "work",
    });
  });
  expect(host.doc.notes.n1).toBeUndefined();
  await waitFor(() => expect(owner().snapshot().work?.handle.revision).toBe(host.revision));
  await act(async () => {
    await owner().restore("undo");
  });
  expect(host.doc).toEqual(before);
});

test("live cannot override the kernel fixture lane", async () => {
  await mounted({ fixture: "plan", live: "1" });
  expect(host.calls).toEqual([]);
});

test("targeting another plan view re-reads rooms, trace and image and clears the old view selection", async () => {
  host.snapshot.levels[0]!.views.push("Another plan");
  const { view, owner } = await mounted();
  await act(async () => {
    owner().view.setPage({ selected: ["00000000-0000-4000-8000-000000000001"] });
  });
  const before = Object.fromEntries(
    ["rooms.snapshot", "rooms.trace", "revit.context.view-image"].map((key) => [
      key,
      host.calls.filter((call) => call.key === key).length,
    ]),
  );
  fireEvent.click(view.getByRole("button", { name: "Choose view" }));
  fireEvent.click(await view.findByRole("option", { name: "Another plan" }));
  await waitFor(() =>
    expect(owner().view.read().page).toMatchObject({
      view: "Another plan",
      selected: [],
      viewport: null,
    }),
  );
  await waitFor(() => {
    for (const [key, count] of Object.entries(before))
      expect(host.calls.filter((call) => call.key === key).length).toBeGreaterThan(count);
  });
  expect(view.queryByLabelText("Route refused")).toBeNull();
  expect(host.actions).toEqual([]);
  expect(host.writes).toEqual([]);
});

test("plan and feedback use one kernel frame each and History is the shared journal", async () => {
  const { view, owner } = await mounted();
  for (const id of ["plan", "feedback"]) {
    const pane = view.container.querySelector(`[data-pane-id="${id}"]`)!;
    expect(pane).toBeTruthy();
    expect(pane.querySelector("[data-pane-id]")).toBeNull();
  }
  expect(view.getByRole("button", { name: "copy markdown" })).toBeTruthy();
  act(() => {
    owner().timeline.append({ kind: "checkpoint", at: 123, receiptId: "room-proof" });
    owner().view.setPage({ stage: "history" });
  });
  const history = view.container.querySelector<HTMLElement>('[data-pane-id="history"]')!;
  expect(history).toBeTruthy();
  expect(within(history).getByText(new RegExp(`checkpoint.*${activityTime(123)}`))).toBeTruthy();
});

test("manual refresh rereads Rooms and Work without exporting the view image", async () => {
  const { owner, situation } = await mounted();
  const count = (key: string) => host.calls.filter((call) => call.key === key).length;
  const before = {
    snapshot: count("rooms.snapshot"),
    trace: count("rooms.trace"),
    image: count("revit.context.view-image"),
  };
  fireEvent.click(await liveButton(situation, "refresh"));
  await waitFor(() =>
    expect(owner().results.get("refresh")).toMatchObject({ state: "done", kind: "query" }),
  );
  await waitFor(() => expect(count("rooms.snapshot")).toBeGreaterThan(before.snapshot));
  await waitFor(() => expect(count("rooms.trace")).toBeGreaterThan(before.trace));
  expect(count("revit.context.view-image")).toBe(before.image);
  expect(host.writes).toEqual([]);
});
