// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, waitFor, within } from "@testing-library/react";
import { createMemoryHistory, createRouter, RouterContextProvider } from "@tanstack/react-router";
import { afterEach, beforeEach, expect, test, vi } from "vite-plus/test";
import { actionReceiptSchema, actionStatusSchema, type Machine } from "@pe/agent-contracts";
import { Route as root } from "../routes/__root";
import type { ReadingDelivery, ReadingSource } from "#/shell/readings";
import { openAdapters, openRoute, OpenPage } from "./route";
import { BAY_RECENTS, BAY_THREADS, MACHINE_SEEDS } from "./seeds";
const transport = vi.hoisted(() => ({ run: vi.fn() }));
vi.mock("../routes/__root", async () => ({
  Route: (await import("@tanstack/react-router")).createRootRoute(),
}));
vi.mock("../../../../packages/mcps/src/shared/takeoff-action-client", async (original) => ({
  ...(await original<
    typeof import("../../../../packages/mcps/src/shared/takeoff-action-client")
  >()),
  runSemanticAction: transport.run,
}));
const sources = openAdapters.sources;
const machine = (MACHINE_SEEDS["patch-bay"] as { observation: Machine }).observation;
let publishMachine: ReadingDelivery;
let machineReads = 0;
let holdMachine = false;
const releases: (() => void)[] = [];
const fixed = (value: unknown, kind: "use" | "feed" = "use"): ReadingSource => ({
  kind,
  open: (_, deliver) => deliver({ kind: "complete", value, revision: 1 }),
});
beforeEach(() => {
  machineReads = 0;
  holdMachine = false;
  transport.run.mockReset().mockImplementation(async (key, input) =>
    actionReceiptSchema.parse({
      id: "lifecycle-1",
      key,
      caller: { kind: "human", via: "local" },
      target: { kind: "host" },
      input,
      basis: null,
      steps: [],
      prepared: { state: "unprepared" },
      recovery: [],
      startedAt: "2026-10-30T00:00:00.000Z",
      state: "succeeded",
      result: {},
    }),
  );
  openAdapters.sources = {
    "open.machine": {
      kind: "use",
      dirties: ["machine", "sdk"],
      open: (_, deliver) => {
        machineReads++;
        publishMachine = deliver;
        if (!holdMachine) deliver({ kind: "complete", value: machine, revision: machineReads });
      },
    },
    "open.recents": fixed(BAY_RECENTS),
    "open.threads": fixed(BAY_THREADS),
    "open.receipts": fixed([]),
    "open.world": fixed([], "feed"),
  };
  vi.stubGlobal(
    "fetch",
    vi.fn(() => Promise.reject(Error("Unexpected host fetch"))),
  );
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
  HTMLElement.prototype.scrollTo = () => {};
  HTMLElement.prototype.scrollIntoView = () => {};
});
afterEach(() => {
  cleanup();
  for (const release of releases.splice(0)) release();
  openAdapters.sources = sources;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
async function mounted(url = "/open", hosted = false) {
  const wrap = vi.spyOn(openAdapters, "wrap");
  const router = createRouter({
    routeTree: root.addChildren([openRoute]),
    history: createMemoryHistory({ initialEntries: [url] }),
  });
  releases.push(router.history.subscribe(router.load));
  await router.load();
  const Component = openRoute.options.component!;
  const view = render(
    <RouterContextProvider router={router}>
      {hosted ? <OpenPage url={false} thread="thread-fixture" /> : <Component />}
    </RouterContextProvider>,
  );
  await view.findByTestId("patch-bay");
  return { view, router, owner: () => wrap.mock.calls.at(-1)![0] };
}
test("the mounted bay patches a document and dispatches its exact semantic intent through the kernel", async () => {
  let history!: ReadingDelivery;
  openAdapters.sources = {
    ...openAdapters.sources,
    "open.receipts": {
      kind: "use",
      open: (_, deliver) => {
        history = deliver;
        deliver({ kind: "complete", value: [], revision: 1 });
      },
    },
  };
  const { view, owner, router } = await mounted();
  fireEvent.click(await view.findByText("Clinic-Fitout.rvt"));
  fireEvent.click(
    await view.findByText("patch Clinic-Fitout.rvt here", {
      selector: "[data-key='free:pid:18244'] *",
    }),
  );
  expect(transport.run).not.toHaveBeenCalled();
  fireEvent.click(
    view.getByRole("button", { name: "Open in your Revit 2025 and upgrade from 2023" }),
  );
  await waitFor(() => expect(transport.run).toHaveBeenCalledTimes(1));
  expect(transport.run.mock.calls[0]!.slice(0, 2)).toEqual([
    "instances.open",
    {
      source: "C:\\Projects\\Clinic\\Clinic-Fitout.rvt",
      into: { session: { pid: 18244 } },
      detach: false,
      upgrade: true,
      links: "refuse",
    },
  ]);
  await waitFor(() =>
    expect(
      owner()
        .timeline.read()
        .some((entry) => entry.kind === "receipt"),
    ).toBe(true),
  );
  await waitFor(() => expect(machineReads).toBeGreaterThan(1));
  const receipt = await transport.run.mock.results[0]!.value;
  act(() => history({ kind: "complete", value: [actionStatusSchema.parse(receipt)], revision: 2 }));
  const activity = within(view.container.querySelector('section[aria-label="History"]')!);
  expect(activity.getByRole("link", { name: "instances.open" })).toBeTruthy();
  expect(activity.getAllByRole("listitem")).toHaveLength(2);
  expect(router.state.location.search).not.toHaveProperty("draft");
  expect(view.queryByRole("textbox", { name: "draft" })).toBeNull();
  expect(view.queryByRole("textbox", { name: "table" })).toBeNull();
  expect(fetch).not.toHaveBeenCalled();
});
test("stale machine evidence refuses an armed stop and hosted Page stays off the URL", async () => {
  const { view, owner, router } = await mounted("/open?demo=refresh", true);
  const card = within(view.getByRole("group", { name: "Revit 2025 started from the Revit icon" }));
  fireEvent.click(card.getByRole("button", { name: "stop" }));
  act(() => publishMachine({ kind: "stale" }));
  fireEvent.click(card.getByRole("button", { name: "stop, keep work" }));
  expect(transport.run).not.toHaveBeenCalled();
  fireEvent.change(view.getByRole("combobox", { name: "table query" }), {
    target: { value: "clinic" },
  });
  await waitFor(() => expect(owner().view.read().page.table.query).toBe("clinic"));
  expect(router.state.location.search).toEqual({ demo: "refresh" });
  expect(owner().view.read().page.demo).toBe("");
  expect(fetch).not.toHaveBeenCalled();
});

test("refreshing stale Machine evidence keeps its Revit cards while pending", async () => {
  const { view } = await mounted();
  act(() => publishMachine({ kind: "stale" }));
  const before = machineReads;
  holdMachine = true;
  fireEvent.click(view.getByRole("button", { name: "refresh" }));
  await waitFor(() => expect(machineReads).toBeGreaterThan(before));
  expect(view.getByRole("group", { name: "Revit 2025 started from the Revit icon" })).toBeTruthy();
});

test("world feed events enter shared History once and old deliveries cannot append after unmount", async () => {
  let publish!: ReadingDelivery;
  openAdapters.sources = {
    ...openAdapters.sources,
    "open.world": {
      kind: "feed",
      open: (_, deliver) => {
        publish = deliver;
        deliver({ kind: "complete", value: [], revision: 1 });
      },
    },
  };
  const { view, owner } = await mounted();
  await waitFor(() => expect(publish).toBeDefined());
  act(() => {
    publish({ kind: "log", id: "world-1", value: { message: "Revit connected" } });
    publish({ kind: "log", id: "world-1", value: { message: "Revit connected" } });
  });
  expect(
    owner()
      .timeline.read()
      .filter((entry) => entry.kind === "feed"),
  ).toHaveLength(1);
  expect(
    within(view.container.querySelector('section[aria-label="History"]')!).getByText(
      /Revit connected/,
    ),
  ).toBeTruthy();
  view.unmount();
  await new Promise((resolve) => setTimeout(resolve, 0));
  publish({ kind: "log", id: "world-2", value: "retired" });
  expect(
    owner()
      .timeline.read()
      .filter((entry) => entry.kind === "feed"),
  ).toHaveLength(1);
});
