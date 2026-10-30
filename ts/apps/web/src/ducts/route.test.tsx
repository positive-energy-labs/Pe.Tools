// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, waitFor, within } from "@testing-library/react";
import { createMemoryHistory, createRouter, RouterContextProvider } from "@tanstack/react-router";
import { afterEach, beforeEach, expect, test, vi } from "vite-plus/test";
import { ductsRouteState, workWriteSchema } from "@pe/agent-contracts";
import { Route as root } from "../routes/__root";
import { ductsGraph } from "./graph";
import { ductsRoute, ductsAdapters } from "./route";
import { DuctsHostFixture } from "./host.fixture";
import { writeRouteWork } from "#/route/host";
import { createRouteOwner, makeAtomRegistry } from "#/shell/owner";
import { kernelCellVerbs } from "#/shell/verbs-cells";
import { invoke, type VerbContext } from "#/shell/verbs";
import { ductsPageSchema } from "./graph";

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
const liveButton = async (scope: ReturnType<typeof within>, name: string | RegExp) =>
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

test("a fresh sheet URL opens a fan and edits its criteria through one kernel Work journal step", async () => {
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
  const input = (await view.findByLabelText("Default terminal drop in-wg")).querySelector("input")!;
  await act(async () => input.focus());
  fireEvent.change(input, { target: { value: "0.11" } });
  fireEvent.blur(input);
  await waitFor(() => expect(host.doc.criteria.edit?.value.terminalDropInWg).toBe(0.11));
  expect(host.writes).toHaveLength(1);
  expect(host.writes[0]).toMatchObject({ kind: "apply", by: "human", base: 1, revision: 2 });
  fireEvent.click(
    await liveButton(within(view.getByLabelText("Sheet inputs")), "Undo criteria terminalDropInWg"),
  );
  await waitFor(() => expect(host.writes).toHaveLength(2));
  expect(host.doc).toEqual(before);
  fireEvent.click(
    await liveButton(within(view.getByLabelText("Sheet inputs")), "Redo criteria terminalDropInWg"),
  );
  await waitFor(() => expect(host.doc.criteria.edit?.value.terminalDropInWg).toBe(0.11));
  expect(host.writes).toHaveLength(3);
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

test("sheet input history retains row labels, restore metadata and before/after totals", async () => {
  host.sheetInputs.terminals["4"] = {
    cfm: { value: 100, source: "typed" },
    drop: { value: 0.03, source: "firm" },
  };
  host.sheetOverview.totals!.requiredEspInWg = 0.2;
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
  const input = (await view.findByLabelText("Default terminal drop in-wg")).querySelector("input")!;
  // Transport supplies distinct totals; the real kernel must bind them to the accepted revision.
  host.sheetOverview.totals!.requiredEspInWg = 0.4;
  await act(async () => input.focus());
  fireEvent.change(input, { target: { value: "0.11" } });
  fireEvent.blur(input);
  await waitFor(() => expect(host.doc.criteria.edit?.value.terminalDropInWg).toBe(0.11));
  expect(view.getByRole("button", { name: "Undo criteria terminalDropInWg" })).toBeTruthy();
  const inputs = within(view.getByLabelText("Sheet inputs"));
  const effect = () => view.container.querySelector("[data-inputs-effect]")!.textContent;
  await waitFor(() => expect(effect()).toContain("required ESP 0.2000 → 0.4000"));
  const beforeClear = structuredClone(host.doc);
  host.sheetInputs.terminals["4"].cfm = { value: 80, source: "revit" };
  host.sheetOverview.totals!.requiredEspInWg = 0.3;
  fireEvent.click(inputs.getByRole("button", { name: /^Clear Terminal airflow / }));
  await waitFor(() => expect(host.doc.flows["4"]).toBeUndefined());
  await waitFor(() => expect(effect()).toContain("required ESP 0.4000 → 0.3000"));
  const restore = await inputs.findByRole("button", {
    name: /^Restore Terminal airflow .*100 cfm/,
  });
  host.sheetInputs.terminals["4"].cfm = { value: 100, source: "typed" };
  host.sheetOverview.totals!.requiredEspInWg = 0.4;
  fireEvent.click(restore);
  await waitFor(() => expect(host.doc).toEqual(beforeClear));
  expect(host.writes.at(-1)).toMatchObject({ kind: "restore", press: null });
  await waitFor(() => expect(effect()).toContain("required ESP 0.3000 → 0.4000"));
  expect(effect()).toContain("undid clear Terminal airflow");
  const redo = await liveButton(inputs, /^Redo clear Terminal airflow /);
  host.sheetInputs.terminals["4"].cfm = { value: 80, source: "revit" };
  host.sheetOverview.totals!.requiredEspInWg = 0.3;
  fireEvent.click(redo);
  await waitFor(() => expect(host.doc.flows["4"]).toBeUndefined());
  await waitFor(() => expect(effect()).toContain("required ESP 0.4000 → 0.3000"));
  expect(effect()).toContain("redid clear Terminal airflow");
  expect(host.writes).toHaveLength(4);
});

test("criteria and unit kinds take and revert through the graph's kernel cell verbs", async () => {
  const kindKey = JSON.stringify(["Broan", "B210E75RT"]);
  host.doc = ductsRouteState.schema.parse({
    criteria: { suggestion: { value: { splitPolicy: "even" } } },
    kinds: { [kindKey]: { suggestion: { value: { kind: "erv" } } } },
  });
  const registry = makeAtomRegistry();
  const owner = createRouteOwner("ducts", registry);
  const { verbs, subjects } = kernelCellVerbs(ductsGraph);
  const context: VerbContext<"human"> = {
    caller: "human",
    owner,
    subjects,
    snapshot: () => ({
      target: { kind: "document", ref: { session: "s", openId: "d" } },
      work: { handle: { key: host.key, revision: host.revision }, doc: host.doc },
      basis: null,
    }),
    write: (key, write) => writeRouteWork(key, { ...write, kind: "apply" }),
  };
  try {
    for (const row of [
      { segment: null, key: "criteria" },
      { segment: "kinds", key: kindKey },
    ]) {
      const subject = ductsAdapters.cell!(row, {
        target: context.snapshot().target,
        work: { handle: { key: host.key, revision: host.revision }, doc: host.doc },
        page: ductsPageSchema.parse({}),
        readings: {},
      })!;
      expect(subject).not.toBeNull();
      expect(
        (await invoke(context, verbs[`${subject.type}.take`]!, subject, undefined)).state,
      ).toBe("done");
      expect(
        (await invoke(context, verbs[`${subject.type}.reopen`]!, subject, undefined)).state,
      ).toBe("done");
    }
    expect(host.doc.criteria.edit).toBeNull();
    expect(host.doc.kinds[kindKey]?.edit).toBeNull();
    expect(host.writes).toHaveLength(4);
  } finally {
    owner.dispose();
    registry.dispose();
  }
});
