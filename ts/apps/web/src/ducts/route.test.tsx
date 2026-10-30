// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, waitFor, within } from "@testing-library/react";
import { createMemoryHistory, createRouter, RouterContextProvider } from "@tanstack/react-router";
import { afterEach, beforeEach, expect, test, vi } from "vite-plus/test";
import { ductsRouteState, workWriteSchema } from "@pe/agent-contracts";
import { Route as root } from "../routes/__root";
import { ductsGraph } from "./graph";
import { ductsRoute } from "./route";
import { DuctsHostFixture } from "./host.fixture";
import { writeRouteWork } from "#/route/host";

let host: DuctsHostFixture;
const releases: (() => void)[] = [];
beforeEach(() => {
  host = new DuctsHostFixture();
  vi.stubGlobal("EventSource", host.source());
  vi.stubGlobal("fetch", host.fetch);
  vi.stubGlobal("Worker", host.worker);
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
});
afterEach(async () => {
  cleanup();
  for (const release of releases.splice(0)) release();
  await new Promise((resolve) => setTimeout(resolve, 450));
  vi.unstubAllGlobals();
});
async function mounted(
  url = "/ducts?target=s&system=SA&picture=schematic&layers=",
  waitForNative = true,
) {
  const router = createRouter({
    routeTree: root.addChildren([ductsRoute]),
    history: createMemoryHistory({ initialEntries: [url] }),
  });
  releases.push(router.history.subscribe(router.load));
  await router.load();
  const Component = ductsRoute.options.component!;
  const view = render(
    <RouterContextProvider router={router}>
      <Component />
    </RouterContextProvider>,
  );
  await view.findByLabelText("Situation");
  if (waitForNative)
    await waitFor(() =>
      expect(host.requests.some((request) => request.key === "ducts.snapshot")).toBe(true),
    );
  return { view, router, situation: within(view.getByLabelText("Situation")) };
}
const liveButton = async (scope: ReturnType<typeof within>, name: string) =>
  waitFor(() => {
    const button = scope.getByRole("button", { name, exact: true });
    expect(button.getAttribute("aria-disabled")).not.toBe("true");
    return button;
  });

test("a URL field round-trips through kernel Page, its edit and a reopened URL", async () => {
  const first = await mounted("/ducts?target=s&system=SA&level=30&picture=schematic&layers=");
  expect((first.situation.getByLabelText("level") as HTMLInputElement).value).toBe("30");
  fireEvent.change(first.situation.getByLabelText("level"), { target: { value: "42" } });
  await waitFor(() => expect(first.router.state.location.search.level).toBe("42"));
  const url = first.router.state.location.href;
  first.view.unmount();
  const reopened = await mounted(url);
  expect((reopened.situation.getByLabelText("level") as HTMLInputElement).value).toBe("42");
  expect(host.writes).toEqual([]);
});

test("snapshot failure has one loading body and semantic Refresh reacquires and reprices", async () => {
  host.snapshotFailure = "Snapshot refused";
  const { view, situation } = await mounted();
  await view.findByText("Snapshot refused", { selector: "[role='alert']" });
  expect(view.getAllByRole("region", { name: "Ducts loading" })).toHaveLength(1);
  host.snapshotFailure = null;
  fireEvent.click(await liveButton(situation, "Refresh"));
  await liveButton(situation, "Price");
  await waitFor(() => expect(view.queryByRole("region", { name: "Ducts loading" })).toBeNull());
  expect(host.actions.map((action) => action.key)).toEqual(["ducts.refresh"]);
  expect(
    host.requests.filter((request) => request.key === "ducts.snapshot").length,
  ).toBeGreaterThan(1);
  expect(host.writes).toEqual([]);
});

test("the ordered network and sheet stages have no picker and render only their graph panes", async () => {
  const { view, router, situation } = await mounted();
  expect(ductsGraph.stageOrder).toEqual(["network", "sheet"]);
  expect(situation.getByText("Pricing systems")).toBeTruthy();
  expect(situation.queryByRole("combobox")).toBeNull();
  expect(situation.queryByRole("button", { name: "Pricing systems" })).toBeNull();
  expect(view.container.querySelector("[data-pane-id='e-inbox']")).not.toBeNull();
  expect(view.container.querySelector("[data-pane-id='sheet-roster']")).toBeNull();
  await act(() =>
    router.navigate({
      to: "/ducts",
      search: { target: "s", stage: "sheet", picture: "schematic", layers: [] },
    }),
  );
  await waitFor(() =>
    expect(within(view.getByLabelText("Situation")).getByText("Pricing fans")).toBeTruthy(),
  );
  expect(view.container.querySelector("[data-pane-id='e-inbox']")).toBeNull();
  for (const pane of ductsGraph.stages.sheet!.panes)
    expect(view.container.querySelector(`[data-pane-id='${pane}']`)).not.toBeNull();
  expect(situation.queryByRole("combobox")).toBeNull();
  expect(
    host.requests.some((request) => request.key === "ducts.snapshot" && !request.request.selector),
  ).toBe(false);
});

test("a fresh sheet URL opens a fan and edits its defaults through one kernel Work journal step", async () => {
  const before = structuredClone(host.doc);
  const { view } = await mounted("/ducts?target=s&stage=sheet&picture=schematic&layers=", false);
  expect(within(view.getByLabelText("Situation")).getByText("Pricing fans")).toBeTruthy();
  await waitFor(() => {
    const row = view.container.querySelector<HTMLElement>("[data-key='14577391:2']");
    expect(row).not.toBeNull();
    expect(row!.getAttribute("aria-disabled")).not.toBe("true");
  });
  fireEvent.click(view.container.querySelector<HTMLElement>("[data-key='14577391:2']")!);
  await waitFor(() =>
    expect(
      host.requests.some((request) => request.key === "sheet"),
      JSON.stringify({
        requests: host.requests,
        alerts: view.queryAllByRole("alert").map((node) => node.textContent),
      }),
    ).toBe(true),
  );
  await view.findByRole("region", { name: "Required ESP" });
  expect(host.requests.some((request) => request.key === "sheet" && !!request.request.detail)).toBe(
    true,
  );
  fireEvent.click(view.getByRole("button", { name: /firm \(file, not yet\)/ }));
  const input = await view.findByLabelText("Terminal drop in-wg");
  fireEvent.change(input, { target: { value: "0.11" } });
  fireEvent.blur(input);
  await waitFor(() => expect(host.doc.sheetDefaults.edit?.value.terminalDropInWg).toBe(0.11));
  expect(host.writes).toHaveLength(1);
  expect(host.writes[0]).toMatchObject({ kind: "apply", by: "human", base: 1, revision: 2 });
  fireEvent.keyDown(view.getByLabelText("Ducts route"), { key: "z", ctrlKey: true });
  await waitFor(() => expect(host.writes).toHaveLength(2));
  expect(host.doc).toEqual(before);
});

test("Price prepares one host preview, shows its kernel ticket, commits the same request and consumes a receipt", async () => {
  const { view, situation } = await mounted();
  fireEvent.click(await liveButton(situation, "Price"));
  const review = await situation.findByLabelText("Price review");
  expect(review.textContent).toContain('"planned":1');
  expect(host.actions.map((row) => row.key)).toEqual(["ducts.preview-losses"]);
  fireEvent.click(await liveButton(situation, "Price"));
  await waitFor(() =>
    expect(host.actions.map((row) => row.key)).toEqual([
      "ducts.preview-losses",
      "ducts.apply-losses",
    ]),
  );
  expect(host.actions[1]!.state).toBe("succeeded");
  expect(host.actions[1]!.input).toEqual(host.actions[0]!.input);
  await waitFor(() => expect(view.queryByLabelText("Price review")).toBeNull());
});

test("a Work write invalidates an open ticket and commit cannot dispatch its apply", async () => {
  const { view, situation } = await mounted();
  fireEvent.click(await liveButton(situation, "Price"));
  await situation.findByLabelText("Price review");
  await act(async () => {
    await writeRouteWork(
      host.key,
      workWriteSchema.parse({
        expectedRevision: host.revision,
        press: "other-human",
        patches: [
          { path: ["flows", "4", "edit"], value: { value: { cfm: 120, source: "changed" } } },
        ],
      }),
    );
  });
  await waitFor(() => expect(host.revision).toBe(2));
  fireEvent.click(await liveButton(situation, "Price"));
  await waitFor(() => expect(view.queryByLabelText("Price review")).toBeNull());
  await waitFor(() =>
    expect(
      within(view.getByLabelText("Situation"))
        .getAllByRole("status")
        .some((status) => /changed|stale/i.test(status.textContent ?? "")),
    ).toBe(true),
  );
  expect(host.actions.map((row) => row.key)).toEqual(["ducts.preview-losses"]);
});

test("taking an assumptions row is one acknowledged journal step and Mod+Z restores it", async () => {
  host.snapshot.issues = [
    { id: "open-end:4:1", kind: "open-end", elementId: 4, note: "Terminal 4 has an open end" },
  ];
  host.snapshot.groups[0]!.issueIds = ["open-end:4:1"];
  host.doc = ductsRouteState.schema.parse({
    assumptions: {
      "open-end:4:1": { suggestion: { value: { kind: "verdict", verdict: "ignore" } } },
    },
  });
  const before = structuredClone(host.doc);
  const { view } = await mounted();
  const row = await waitFor(() => {
    const row = view.container.querySelector<HTMLElement>("[data-key='assumptions:open-end:4:1']");
    expect(row).not.toBeNull();
    return row!;
  });
  fireEvent.click(row);
  fireEvent.click(await liveButton(within(row), "take"));
  await waitFor(() =>
    expect(host.doc.assumptions["open-end:4:1"]?.edit?.value).toMatchObject({
      kind: "verdict",
      verdict: "ignore",
    }),
  );
  expect(host.writes).toHaveLength(1);
  expect(host.writes[0]).toMatchObject({ kind: "apply", by: "human", base: 1, revision: 2 });
  fireEvent.keyDown(view.getByLabelText("Ducts route"), { key: "z", ctrlKey: true });
  await waitFor(() => expect(host.writes).toHaveLength(2));
  expect(host.writes[1]).toMatchObject({ kind: "restore", base: 2, revision: 3, press: null });
  expect(host.doc).toEqual(before);
});
