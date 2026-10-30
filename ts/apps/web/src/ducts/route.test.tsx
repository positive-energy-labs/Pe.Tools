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
import { mountRoute } from "#/shell/mount";
import { noTerminalSnapshot } from "./no-terminal.fixture";
import { chaddsNearMissSnapshot, ra23Snapshot, twoHealNetworksSnapshot } from "./heal.fixture";

test.each(["row", "Situation"])(
  "%s Preview heal targets the pointed-at network among two",
  async (placement) => {
    host.snapshot = twoHealNetworksSnapshot();
    const { view, situation } = await mounted(
      "/ducts?target=s&system=RA%2023&selected=10002955&picture=schematic&layers=",
    );
    const row = await waitFor(() => {
      const element = view.container.querySelector<HTMLElement>('[data-key="heal:g6953999"]');
      expect(element).not.toBeNull();
      return element!;
    });
    if (placement === "Situation") fireEvent.click(within(row).getByText(/^Heal RA 23/));
    fireEvent.click(
      await liveButton(placement === "row" ? within(row) : situation, "Preview heal"),
    );
    await waitFor(() => expect(host.actions).toHaveLength(1));
    expect(host.actions[0]).toMatchObject({
      key: "ducts.preview-heal",
      input: {
        groups: [
          { group: "g6953999", items: [{ key: "cap:14663504:1" }, { key: "cap:14663546:1" }] },
        ],
      },
    });
    expect((host.actions[0]!.input as { groups: unknown[] }).groups).toHaveLength(1);
    const targets = await view.findByLabelText("Heal targets");
    expect(targets.textContent).toContain("cap · 14663504 end 1");
    expect(targets.textContent).toContain("cap · 14663546 end 1");
  },
);

test("Chadds autoJoin ends show their partner and measured gap in the row and Evidence", async () => {
  host.snapshot = chaddsNearMissSnapshot();
  const { view } = await mounted();
  for (const [id, partner, gap] of [
    [14517389, 14548688, "0.01"],
    [14663504, 14663834, "2.25"],
    [14663546, 14663850, "2.25"],
  ] as const) {
    const row = await waitFor(() => {
      const element = view.container.querySelector<HTMLElement>(`[data-key="open-end:${id}:0"]`);
      expect(element).not.toBeNull();
      return element!;
    });
    const words = `faces ${partner}:1 ${gap} in away: a join, not a cap`;
    expect(row.textContent).toContain(words);
    fireEvent.click(within(row).getByText(words, { exact: false }));
    const detail = view.container.querySelector<HTMLElement>(
      `[data-inbox-detail="open-end:${id}:0"]`,
    )!;
    const hint = within(detail).getByRole("button", { name: "What is this?" });
    fireEvent.pointerEnter(hint, { pointerType: "mouse" });
    fireEvent.mouseEnter(hint);
    fireEvent.mouseMove(hint);
    expect((await view.findByRole("tooltip")).textContent).toContain(words);
    fireEvent.pointerLeave(hint, { pointerType: "mouse" });
    fireEvent.mouseLeave(hint);
    await waitFor(() => expect(view.queryByRole("tooltip")).toBeNull());
  }
  expect(host.actions).toEqual([]);
});

test("RA 23 preview shows its cap review, then Heal uses exactly the admitted plan", async () => {
  host.snapshot = ra23Snapshot();
  const { view, situation } = await mounted(
    "/ducts?target=s&system=RA%2023&picture=schematic&layers=",
  );
  fireEvent.click(await liveButton(situation, "Preview heal"));
  const review = await view.findByLabelText("Heal preview");
  expect(review.textContent).toMatch(/10002955.*end 9.*8 in round.*planned/);
  await waitFor(() => expect(view.container.querySelector("[data-review-target]")).not.toBeNull());
  expect(view.getByLabelText("Heal targets").textContent).toContain("cap · 10002955 end 9");
  const input = host.actions[0]!.input;
  fireEvent.click(await liveButton(situation, "Heal"));
  await view.findByLabelText("Heal review");
  fireEvent.click(await liveButton(within(view.getByLabelText("Heal review")), "Commit Heal"));
  await waitFor(() =>
    expect(host.actions.map((a) => a.key)).toEqual(["ducts.preview-heal", "ducts.apply-heal"]),
  );
  expect(host.actions[1]!.input).toEqual(input);
});

test("the Fix list drops flowing caps while the new pricing job is still pending", async () => {
  host.snapshot = ra23Snapshot();
  const { view, situation } = await mounted(
    "/ducts?target=s&system=RA%2023&picture=schematic&layers=",
  );
  await waitFor(() => expect(view.getAllByText(/^Heal RA 23/).length).toBeGreaterThan(0));
  host.snapshot = structuredClone(host.snapshot);
  host.snapshot.segments[0]!.connectors.at(-1)!.flowCfm = 444;
  const pending = vi.spyOn(host.worker.prototype, "postMessage").mockImplementation(() => {});
  try {
    act(() => host.invalidate());
    await waitFor(() => expect(pending).toHaveBeenCalled());
    await waitFor(() =>
      expect(
        situation.getByRole("button", { name: "Preview heal" }).getAttribute("aria-disabled"),
      ).toBe("true"),
    );
    expect(view.queryByText(/^Heal RA 23/)).toBeNull();
  } finally {
    pending.mockRestore();
  }
});

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
  hosted = false,
) {
  const router = createRouter({
    routeTree: root.addChildren([ductsRoute]),
    history: createMemoryHistory({ initialEntries: [url] }),
  });
  releases.push(router.history.subscribe(router.load));
  await router.load();
  const Component = ductsRoute.options.component!;
  const Hosted = mountRoute(ductsGraph, {
    ...ductsAdapters,
    initialPage: { stage: "sheet", fan: "14577391:2", picture: "schematic", layers: [] },
  });
  const view = render(
    <RouterContextProvider router={router}>
      <Component />
      {hosted && (
        <section aria-label="Hosted chat pane">
          <Hosted thread="journal-proof" target="s" url={false} />
        </section>
      )}
    </RouterContextProvider>,
  );
  await view.findAllByLabelText("Situation");
  if (waitForNative)
    await waitFor(() =>
      expect(host.requests.some((request) => request.key === "ducts.snapshot")).toBe(true),
    );
  return { view, router, situation: within(view.getAllByLabelText("Situation")[0]!) };
}
const liveButton = async (scope: ReturnType<typeof within>, name: string | RegExp) =>
  waitFor(() => {
    const button = scope.getByRole("button", { name });
    expect(button.getAttribute("aria-disabled")).not.toBe("true");
    expect(button.hasAttribute("disabled")).toBe(false);
    return button;
  });

test("Situation draws all declared network verbs and chooses systems from the roster", async () => {
  const { view, situation, router } = await mounted();
  for (const name of [
    "Refresh",
    "Preview",
    "Write to Revit",
    "Preview heal",
    "Heal",
    "Preview fan",
    "Make the fan",
  ])
    expect(situation.getByRole("button", { name })).toBeTruthy();
  expect(situation.queryByLabelText("systemSearch")).toBeNull();
  expect(situation.queryByLabelText("selected")).toBeNull();
  expect(situation.getByRole("group", { name: "log kind" })).toBeTruthy();
  fireEvent.click(await liveButton(situation, "Preview"));
  await waitFor(() =>
    expect(host.actions.map((action) => action.key)).toEqual(["ducts.preview-losses"]),
  );
  fireEvent.click(situation.getByRole("button", { name: "Choose system" }));
  fireEvent.click(await view.findByRole("option", { name: /SA/ }));
  await waitFor(() => expect(router.state.location.search.system).toEqual([]));
});

test("opening a fan pushes its Page identity into a link that reopens the sheet", async () => {
  const first = await mounted("/ducts?target=s&stage=sheet&picture=schematic&layers=", false);
  await waitFor(() =>
    expect(first.view.container.querySelector("[data-key='14577391:2']")).not.toBeNull(),
  );
  fireEvent.click(first.view.container.querySelector<HTMLElement>("[data-key='14577391:2']")!);
  await first.view.findByRole("region", { name: "Required ESP" });
  expect(first.router.state.location.search.fan).toBe("14577391:2");
  const url = first.router.state.location.href;
  first.view.unmount();
  const reopened = await mounted(url, false);
  await reopened.view.findByRole("region", { name: "Required ESP" });
  expect(
    reopened.view.container.querySelector("[data-key='14577391:2'][aria-selected='true']"),
  ).not.toBeNull();
  expect(host.writes).toEqual([]);
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
  await liveButton(situation, "Write to Revit");
  await waitFor(() => expect(view.queryByRole("region", { name: "Ducts loading" })).toBeNull());
  expect(host.actions.map((action) => action.key)).toEqual(["ducts.refresh"]);
  expect(
    host.requests.filter((request) => request.key === "ducts.snapshot").length,
  ).toBeGreaterThan(1);
  expect(host.writes).toEqual([]);
});

test("a fan without terminals shows its pricing failure and native picture while Heal remains available", async () => {
  host.snapshot = noTerminalSnapshot();
  // A zero-flow dangling end is a valid cap repair. An outlet carrying air remains protected.
  host.snapshot.segments[0]!.connectors[1]!.flowCfm = 0;
  const { view, situation } = await mounted(
    "/ducts?target=s&system=EX%201&picture=schematic&layers=",
  );
  await view.findByText("EX 1 has no terminal and no fan-to-terminal path; nothing to price", {
    selector: "[role='alert']",
  });
  expect(view.queryByRole("region", { name: "Ducts loading" })).toBeNull();
  expect(
    view.container.querySelector("[data-schematic-group='g1'] [data-element='11620957']"),
  ).not.toBeNull();
  await liveButton(situation, "Heal");
  fireEvent.click(await liveButton(situation, "Preview heal"));
  await waitFor(() =>
    expect(host.actions.map((action) => action.key)).toContain("ducts.preview-heal"),
  );
});

test("the ordered network and sheet stages have no picker and render only their graph panes", async () => {
  const { view, router, situation } = await mounted();
  expect(ductsGraph.stageOrder).toEqual(["network", "sheet"]);
  expect(situation.getByText(/^Pricing systems on /)).toBeTruthy();
  expect(situation.queryByRole("button", { name: "Choose stage" })).toBeNull();
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
    expect(within(view.getByLabelText("Situation")).getByText(/^Pricing fans on /)).toBeTruthy(),
  );
  expect(view.container.querySelector("[data-pane-id='e-inbox']")).toBeNull();
  for (const pane of ductsGraph.stages.sheet!.panes)
    expect(view.container.querySelector(`[data-pane-id='${pane}']`)).not.toBeNull();
  const sheetSituation = within(view.getByLabelText("Situation"));
  for (const name of [
    "Refresh",
    "Preview",
    "Write to Revit",
    "Preview heal",
    "Heal",
    "Preview fan",
    "Make the fan",
  ])
    expect(sheetSituation.getByRole("button", { name })).toBeTruthy();
  expect(situation.queryByRole("button", { name: "Choose stage" })).toBeNull();
  expect(
    host.requests.some((request) => request.key === "ducts.snapshot" && !request.request.selector),
  ).toBe(false);
});

test("a fresh sheet URL opens a fan and edits its criteria through one kernel Work journal step", async () => {
  const before = structuredClone(host.doc);
  const { view } = await mounted("/ducts?target=s&stage=sheet&picture=schematic&layers=", false);
  expect(within(view.getByLabelText("Situation")).getByText(/^Pricing fans on /)).toBeTruthy();
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
  fireEvent.click(await liveButton(situation, "Write to Revit"));
  const review = await view.findByLabelText("Write to Revit review");
  expect(review.textContent).toContain("1 planned");
  expect(review.textContent).not.toContain('"receipt"');
  expect(review.textContent).toContain("terminal flow");
  expect(host.actions.map((row) => row.key)).toEqual(["ducts.preview-losses"]);
  fireEvent.click(await liveButton(within(review), "Commit Write to Revit"));
  await waitFor(() =>
    expect(host.actions.map((row) => row.key)).toEqual([
      "ducts.preview-losses",
      "ducts.apply-losses",
    ]),
  );
  expect(host.actions[1]!.state).toBe("succeeded");
  expect(host.actions[1]!.input).toEqual(host.actions[0]!.input);
  await waitFor(() => expect(view.queryByLabelText("Write to Revit review")).toBeNull());
});

test("a Work write invalidates an open ticket and commit cannot dispatch its apply", async () => {
  const { view, situation } = await mounted();
  fireEvent.click(await liveButton(situation, "Write to Revit"));
  await view.findByLabelText("Write to Revit review");
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
  fireEvent.click(await liveButton(situation, "Write to Revit"));
  await waitFor(() => expect(view.queryByLabelText("Write to Revit review")).toBeNull());
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
  expect(within(view.getByLabelText("Situation")).getByText(/^Pricing fans on /)).toBeTruthy();
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

test("clearing the only part drop keeps its row under typed-only and restores through the journal", async () => {
  host.doc.componentDrops["4"] = { edit: { value: { inWg: 0.12 } } };
  host.sheetInputs.components["4"] = { drop: { value: 0.12, source: "typed" } };
  const before = structuredClone(host.doc);
  const { view } = await mounted("/ducts?target=s&stage=sheet&picture=schematic&layers=", false);
  await waitFor(() =>
    expect(view.container.querySelector("[data-key='14577391:2']")).not.toBeNull(),
  );
  fireEvent.click(view.container.querySelector<HTMLElement>("[data-key='14577391:2']")!);
  await view.findByRole("region", { name: "Required ESP" });
  const inputs = within(await view.findByLabelText("Sheet inputs"));
  fireEvent.click(inputs.getByRole("button", { name: "Show typed inputs only" }));
  const clear = await liveButton(inputs, /^Clear Part drop /);
  delete host.sheetInputs.components["4"];
  expect(clear.isConnected).toBe(true);
  fireEvent.click(clear);
  await waitFor(() => expect(host.doc.componentDrops["4"]).toBeUndefined());
  const restore = await inputs.findByRole("button", { name: /^Restore Part drop / });
  expect(restore.closest("[data-input-field]")?.getAttribute("data-input-field")).toBe(
    "component:4:drop",
  );
  expect(restore.closest("[data-inputs-orphan]")).toBeNull();
  host.sheetInputs.components["4"] = { drop: { value: 0.12, source: "typed" } };
  fireEvent.click(restore);
  await waitFor(() => expect(host.doc).toEqual(before));
  expect(host.writes.at(-1)?.kind).toBe("restore");
  expect(inputs.queryByRole("button", { name: /^Restore Part drop / })).toBeNull();
});

test.each(["Heal", "Preview heal"])(
  "%s lands readable repairs and targets in the picture",
  async (verb) => {
    const segment = host.snapshot.segments[0]!;
    segment.connectors.push({
      ...segment.connectors[0]!,
      index: 9,
      point: [-10, 0, 0],
      facing: [-1, 0, 0],
      diameterIn: 8,
      connectedTo: null,
    });
    host.snapshot.issues.push({
      id: "open-end:1:9",
      kind: "open-end",
      elementId: 1,
      connector: 9,
      note: "open end",
    });
    const { view, situation } = await mounted();
    const controls =
      verb === "Heal"
        ? within(view.container.querySelector<HTMLElement>("[data-pane-id='e-inbox']")!)
        : situation;
    fireEvent.click(await liveButton(controls, verb));
    if (verb === "Heal") {
      const review = await view.findByLabelText("Heal review");
      expect(review.textContent).toContain("1 planned");
      expect(review.textContent).toContain("cap");
      expect(review.textContent).not.toContain('"receipt"');
    }
    await waitFor(() =>
      expect(
        view.container.querySelector("[data-review-target]"),
        view
          .queryAllByRole("alert")
          .map((n) => n.textContent)
          .join(" "),
      ).not.toBeNull(),
    );
    expect(view.getAllByLabelText("Heal in picture")[0]!.textContent).toContain("1 planned");
    expect(host.actions.map((a) => a.key)).toEqual(["ducts.preview-heal"]);
    if (verb === "Heal") {
      fireEvent.click(await liveButton(within(view.getByLabelText("Heal review")), "Commit Heal"));
      await waitFor(() =>
        expect(host.actions.map((a) => a.key)).toEqual(["ducts.preview-heal", "ducts.apply-heal"]),
      );
    }
  },
);

test("page and hosted fan sheets bind journal chords once per focused mount without duplicate warnings", async () => {
  const warn = vi.spyOn(console, "warn");
  const wrap = vi.spyOn(ductsAdapters, "wrap");
  try {
    const { view } = await mounted(
      "/ducts?target=s&stage=sheet&fan=14577391:2&picture=schematic&layers=",
      false,
      true,
    );
    const regions = view.getAllByRole("region", { name: "Ducts route" });
    expect(regions).toHaveLength(2);
    const page = within(regions[0]!);
    const chat = within(regions[1]!);
    await page.findByRole("region", { name: "Required ESP" });
    await chat.findByRole("region", { name: "Required ESP" });
    const owners = [...new Set(wrap.mock.calls.map((call) => call[0]))];
    expect(owners).toHaveLength(2);
    const edit = async (value: string, count: number) => {
      await waitFor(() => {
        for (const owner of owners) {
          expect(owner.snapshot().work?.handle.revision).toBe(host.revision);
          expect(owner.readings.get("sheet").current).toBe(true);
        }
      });
      const input = page.getByLabelText("Default terminal drop in-wg").querySelector("input")!;
      await act(async () => input.focus());
      fireEvent.change(input, { target: { value } });
      fireEvent.blur(input);
      await waitFor(() => expect(host.writes).toHaveLength(count));
    };
    await edit("0.11", 1);
    await edit("0.12", 2);
    const restores = owners.map((owner) => vi.spyOn(owner, "restore"));
    const undo = async (scope: ReturnType<typeof within>, count: number) => {
      await waitFor(() => {
        for (const owner of owners) {
          expect(owner.snapshot().work?.handle.revision).toBe(host.revision);
          expect(owner.journal(owner.snapshot().work!.handle.key).read().busy).toBe(false);
        }
      });
      const button = scope.getByRole("button", { name: "Refresh" });
      button.focus();
      fireEvent.keyDown(button, { key: "z", code: "KeyZ", ctrlKey: true });
      fireEvent.keyUp(button, { key: "z", code: "KeyZ", ctrlKey: true });
      await waitFor(() =>
        expect(host.writes, owners.map((owner) => owner.journalRefusal()).join("; ")).toHaveLength(
          count,
        ),
      );
    };
    await undo(page, 3);
    expect(host.doc.criteria.edit?.value.terminalDropInWg).toBe(0.11);
    expect(restores[0]).toHaveBeenCalledTimes(1);
    expect(restores[1]).not.toHaveBeenCalled();
    await undo(chat, 4);
    expect(host.doc.criteria.edit).toBeUndefined();
    expect(restores[0]).toHaveBeenCalledTimes(1);
    expect(restores[1]).toHaveBeenCalledTimes(1);
    expect(host.writes.slice(2).every((write) => write.kind === "restore")).toBe(true);
    expect(
      warn.mock.calls.filter((args) =>
        args.some((value) => String(value).includes("already registered")),
      ),
    ).toEqual([]);
    for (const restore of restores) restore.mockRestore();
  } finally {
    wrap.mockRestore();
    warn.mockRestore();
  }
});
