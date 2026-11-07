// @vitest-environment jsdom
import { useState, useSyncExternalStore } from "react";
import { journey as takeoffJourney, Drawing as TakeoffDrawing } from "../takeoff/adoption.test.fixture";
import { adoptionData } from "@pe/agent-contracts/takeoff-read";
import { createPortal } from "react-dom";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vite-plus/test";
import { createMemoryHistory, createRootRoute, createRouter, RouterProvider } from "@tanstack/react-router";
import { route } from "./typed-route";
import { module as fans } from "../fans/route";
import { TypedChrome, TypedShell } from "../shell/typed-shell";
import * as mounts from "../shell/typed-mount";
import { familiesRouteState, address, workFingerprintSchema, type WorkJournalDoor } from "@pe/agent-contracts";
import { ReviewSurface } from "../shell/review-surface";
import { RouteVisibility } from "./activity";
import { setup as scheduleHost } from "../../../host/tests/schedule-test-fixture";
import { module as schedules } from "../schedules/route";
import { namesOf } from "./typed-route";
import { createWorkFeedClient } from "../shell/work-feed-client";
import type { UseSource } from "../shell/source-contract";
import { KeyScopeHost } from "@pe/kit/keys";
import { module as families } from "../families/route";
import { createFixtureWorkDoor } from "../shell/fixture-work-door";
import { module as family } from "../family/route";
import { detailResponse } from "../../../host/tests/schedule-fixture";
import { createPeClient } from "@pe/agent-contracts/pe-api";
import { contextFetch } from "@pe/runtime/context";
import { routeInput } from "./host";

test("JZ Schedules Description Enter stages r3, reviews BEFORE to AFTER, and shows a refused edit at its cell", async () => {
  const host = await scheduleHost({ cold: true });
  const detail = detailResponse();
  const entry = detail.entries[0]!;
  entry.columns[1]!.headerText = "Description";
  entry.rows[0]!.values = ["SH1", "Duct heater"];
  Object.assign(entry.rows[0]!.bindings[0]!, {
    parameterName: "PE_G___Description", storageType: "String", rawValue: "Duct heater",
    displayValue: "Duct heater", targetElementIds: [7],
    targets: [{ ...entry.rows[0]!.bindings[0]!.targets[0]!, storageType: "String", rawValue: "Duct heater" }],
  });
  const second = structuredClone(entry.rows[0]!);
  second.rowNumber = 2;
  second.values[0] = "SH2";
  second.subjectIds = [8];
  second.bindings[0]!.targetElementIds = [8];
  second.bindings[0]!.targets[0]!.elementId = 8;
  entry.rows.push(second);
  host.setDetail(detail);
  const client = createPeClient(host.base, contextFetch);
  const pending = new Set<Promise<void>>();
  const listeners = new Set<(state: any) => void>();
  const publishWork = async () => {
    const state = await host.view();
    for (const deliver of listeners) deliver(state.revision === 0 ? { kind: "absent" } : {
      kind: "ready", history: { from: 0, acks: [] },
      snapshot: { handle: { key: host.scope, revision: state.revision }, revision: state.revision, value: state.doc },
    });
  };
  // Replay the existing fixture's HTTP inspection transport. Every state and refusal
  // comes from the production host; no fixture code chooses a revision or edited value.
  const native = createWorkFeedClient({ subscribe: () => () => {}, dirty() {} }, {
    write: async (key, body) => {
      const response = await client.response("work.apply", { ...routeInput(key.route, key), body });
      const wire = await response.json();
      return response.ok ? wire : wire.error.details;
    },
    submit: async command => {
      const response = await host.post("/actions", command);
      if (response.status >= 400) throw Error(JSON.stringify(response.value));
      const result = await host.owner().wait(command.id);
      await publishWork();
      return result;
    },
  });
  const work: WorkJournalDoor = { ...native, open: () => ({ subscribe(deliver) {
    listeners.add(deliver); const task = publishWork(); pending.add(task);
    void task.finally(() => pending.delete(task));
    return () => { listeners.delete(deliver); };
  } }) };
  const source: UseSource = { kind: "use", open(ctx, deliver) {
    const task = host.post("/pe/reads/value", {
      read: "schedules.view", subscription: crypto.randomUUID(), generation: 1,
      args: { target: host.b, ...(ctx.args as object) },
    }).then(response => {
      expect(response.status).toBe(200);
      if (!ctx.signal.aborted) deliver({ kind: "complete", value: response.value, revision: 1 });
    });
    pending.add(task); void task.finally(() => pending.delete(task)); return () => {};
  } };
  const search = new URLSearchParams();
  const mount = mounts.mountTypedRoute(schedules, {
    address: { read: () => new URLSearchParams(search), write: next => { for (const [k,v] of next) search.set(k,v); }, subscribe: () => () => {} },
    fixture: null, target: { kind: "document", ref: host.b }, work: { address: null, open: host.b },
    custody: { current: () => true }, memory: () => ({}),
  }, workFingerprintSchema.parse(`builtin-closure:${"a".repeat(64)}`), { work, sources: { "schedules.view": source } });
  function Journey() {
    useSyncExternalStore(mount.subscribe, mount.revision, mount.revision);
    return <KeyScopeHost id="schedules-cell-edit"><TypedChrome mount={mount} document={<span>Project schedules</span>} /></KeyScopeHost>;
  }
  const router = createRouter({ routeTree: createRootRoute({ component: Journey }), history: createMemoryHistory({ initialEntries: ["/schedules"] }) });
  const view = render(<RouterProvider router={router} />);
  try {
    fireEvent.click(await screen.findByRole("button", { name: "Choose schedule" }));
    fireEvent.click(await screen.findByRole("option", { name: "Panel" }));
    fireEvent.click(await screen.findByRole("button", { name: "Start" }));
    await waitFor(() => expect(mount.work()?.handle.revision).toBe(1));
    await waitFor(() => expect(mount.value().current).toBe(true));
    fireEvent.click(screen.getAllByRole("button", { name: "Read schedule" })[1]!);
    await waitFor(() => expect(mount.work()?.handle.revision).toBe(2));
    await waitFor(() => expect(mount.problem()).toBeNull());
    await screen.findByText("SH1");
    await screen.findByText("SH2");
    const input = (await screen.findAllByDisplayValue("Duct heater"))[0] as HTMLInputElement;
    // Driver clicked the cell's left edge, then Ctrl+A and Input.insertText.
    // A mouse-selected editable cell must give native text insertion an input.
    const cell = input.closest("td")!;
    act(() => cell.focus()); // jsdom has no browser default mousedown focus.
    fireEvent.mouseDown(cell);
    fireEvent.mouseUp(cell);
    fireEvent.click(cell);
    expect.soft(document.activeElement, "A clicked editable cell receives native text input before Enter").toBe(input);
    const active = document.activeElement!;
    fireEvent.keyDown(active, { key: "a", code: "KeyA", ctrlKey: true });
    // Native insertText has no printable keydown. It can edit only a focused editor.
    if (active === input) fireEvent.input(input, { target: { value: "Duct heater - gate review" }, inputType: "insertText", data: "Duct heater - gate review" });
    fireEvent.keyDown(active, { key: "Enter", code: "Enter" });
    await waitFor(async () => expect(await host.view()).toMatchObject({ revision: 3, doc: { cells: { "1::2": { edit: { value: "Duct heater - gate review" } } } } }));
    // This recorded HTTP read adapter has no invalidation socket; Refresh re-reads host Value.
    act(() => mount.refresh());
    await waitFor(() => expect(mount.problem()).toBeNull());
    await screen.findByDisplayValue("Duct heater - gate review");
    fireEvent.click(screen.getByRole("button", { name: /plan Apply cells/i }));
    await screen.findByText(/SH1.*Description: Duct heater → Duct heater - gate review/);
    act(() => mount.cancel("push"));
    // Another writer advances Work behind the drawn cell. The host must refuse the
    // stale revision and its real reason must remain beside the user's cell.
    await host.patch([{ path: ["cells", "1::2"], value: { edit: { value: "Other writer" } } }]);
    const current = screen.getByDisplayValue("Duct heater - gate review");
    fireEvent.mouseDown(current);
    fireEvent.mouseUp(current);
    fireEvent.click(current);
    expect(document.activeElement).toBe(current);
    fireEvent.change(current, { target: { value: "Must visibly refuse" } });
    fireEvent.keyDown(current, { key: "Enter", code: "Enter" });
    await waitFor(() => expect(within(current.closest("td")!).getByText(/document moved|revision|changed/i)).toBeTruthy());
    expect(await host.view()).toMatchObject({ revision: 4, doc: { cells: { "1::2": { edit: { value: "Other writer" } } } } });
  } finally { view.unmount(); mount.dispose(); await Promise.all(pending); }
}, 30_000);

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

test("JZ Ducts chooser query keys preserve open systems until an explicit choice", async () => {
  const [{ default: userEvent }, { fixture, ref, path }, { registeredReads }, reads,
    { module: ducts }, { TypedSubject }, { observeResources }, { valueReadResponse }, { localId }] = await Promise.all([
    import("@testing-library/user-event"), import("../../../host/tests/host-read-graph.test-support"),
    import("../../../host/src/reads/routes"), import("../../../host/src/reads/ducts"),
    import("../ducts/route"), import("../shell/typed-shell"), import("@pe/runtime"),
    import("@pe/agent-contracts"), import("./typed-route"),
  ]);
  const { default: saved } = await import("../ducts/fixtures/synthetic-snapshot.json");
  const { nativeResponseSchema } = await import("@pe/host-contracts/decoders");
  const snapshot = nativeResponseSchema("ducts.snapshot.walk").parse(saved);
  snapshot.systems = [snapshot.systems[0]!, { ...snapshot.systems[0]!, id: 501, name: "SA 16" }];
  for (const element of [...snapshot.nodes, ...snapshot.segments]) element.uniqueId ||= `chooser-${element.id}`;
  const host = await fixture(false, { snapshot, roster: { ...snapshot, groups: [], segments: [], flows: [] } });
  const definitions = [reads.ductsPricing, reads.ductsNetwork, reads.ductsRoster];
  const unregister = registeredReads.register(Object.fromEntries(definitions
    .filter(d => !registeredReads.reads.has(d.name)).map(d => [d.name, d])));
  let generation = 0;
  const requests: unknown[] = [];
  const sources = Object.fromEntries(definitions.map(d => [`${d.name}.value`, {
    kind: "use" as const,
    open(ctx, deliver) {
      requests.push(ctx.args);
      return host.probe({ read: d.name, subscription: `chooser-${++generation}`, generation,
        args: { target: ref, ...(ctx.args as object) } }).then(async response => {
        if (!response.ok) throw Error(await response.text());
        const packet = valueReadResponse.parse(await response.json());
        deliver({ kind: "complete", value: packet, revision: packet.version });
      }).catch(error => deliver({ kind: "failure", error }));
    },
  } satisfies UseSource]));
  let search = new URLSearchParams({ system: JSON.stringify({ kind: "ids", ids: [localId("ducts-system", "SA 1")] }) });
  const listeners = new Set<() => void>();
  const work = createWorkFeedClient({ subscribe: observeResources(host.workspace, { observe: () => () => {} }), dirty() {} }, {
    write: (key, write) => host.workspace.write(key, key.route, "human", write),
    submit: () => { throw Error("Chooser journey cannot write native data"); },
  });
  const mount = mounts.mountTypedRoute(ducts, {
    target: { kind: "document", ref }, fixture: null, work: { address: path, open: ref },
    custody: { current: () => true }, memory: () => ({}),
    address: { read: () => new URLSearchParams(search), write(next) { search = next; listeners.forEach(f => f()); },
      subscribe(f) { listeners.add(f); return () => { listeners.delete(f); }; } },
  }, workFingerprintSchema.parse(`builtin-closure:${"a".repeat(64)}`), { work, sources });
  let view: ReturnType<typeof render> | undefined;
  try {
    await waitFor(() => expect(mount.value().current).toBe(true), { timeout: 20_000 });
    const pending: string[] = [];
    const unsubscribe = mount.subscribe(() => { if (mount.value().status === "pending") pending.push(mount.value().status); });
    const root = createRootRoute({ component: () => <KeyScopeHost id="chooser-journey"><TypedSubject mount={mount} /></KeyScopeHost> });
    const router = createRouter({ routeTree: root, history: createMemoryHistory({ initialEntries: ["/ducts"] }) });
    view = render(<RouterProvider router={router} />);
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Choose system" }));
    await user.click(await screen.findByRole("combobox", { name: "system search" }));
    const before = search.toString(), count = requests.length;
    for (const key of "SA 16") {
      await user.keyboard(key);
      expect.soft(search.toString(), `query key ${JSON.stringify(key)} never changes URL selection`).toBe(before);
    }
    expect((screen.getByRole("combobox", { name: "system search" }) as HTMLInputElement).value).toBe("SA 16");
    expect(screen.queryByRole("option", { name: "SA 1" }), "filtered-out selected item stays open").toBeNull();
    expect.soft(mount.page.read().system).toEqual({ kind: "ids", ids: [localId("ducts-system", "SA 1")] });
    expect.soft(pending, "query never starts Reading").toEqual([]);
    expect.soft(requests.length, "query never dispatches a host read").toBe(count);
    unsubscribe();
    await user.click(screen.getByRole("option", { name: "SA 16" }));
    // The ordinary Ducts chooser opens multiple systems. A choice adds SA 16; SA 1 stays open.
    await waitFor(() => expect(mount.page.read().system.ids).toEqual([
      localId("ducts-system", "SA 1"), localId("ducts-system", "SA 16"),
    ]));
    await waitFor(() => expect(mount.value().current).toBe(true), { timeout: 20_000 });
    expect(requests.length).toBeGreaterThan(count);
  } finally { view?.unmount(); mount.dispose(); unregister(); await host.close(); }
});

test("JM H17 browse an optional host route without a pin, then refuse malformed document pins", async () => {
  const module = route({ ...family.spec, edits: undefined, core: undefined, commands: {}, reads: {},
    panes: { main: { title: "Optional document", purpose: "Inspect exact target authority",
      draw: ctx => <p role="status">{ctx.target?.kind === "host" ? "Host browsing" : "Pinned document"}</p> } },
    layout: { kind: "pane", id: "main" } });
  const stamp = workFingerprintSchema.parse(`builtin-closure:${"a".repeat(64)}`);
  let search = new URLSearchParams();
  const listeners = new Set<() => void>();
  const address = { read: () => new URLSearchParams(search), write(next: URLSearchParams) { search = next; listeners.forEach(f => f()); },
    subscribe(f: () => void) { listeners.add(f); return () => { listeners.delete(f); }; } };
  const root = createRootRoute({ component: () => <TypedShell module={module} fingerprint={stamp} address={address} /> });
  const router = createRouter({ routeTree: root, history: createMemoryHistory({ initialEntries: ["/"] }) });
  render(<RouterProvider router={router} />);
  await screen.findByText("Host browsing");
  address.write(new URLSearchParams({ target: "not JSON" }));
  await waitFor(() => expect(screen.queryByText("Host browsing"), "H17: a bad pin never falls back to host authority").toBeNull());
  expect(screen.queryByText("Pinned document"), "H17: unresolved pin grants no document authority").toBeNull();
});

test("JZ B04 read a long review, dismiss with Escape and return to its opener", async () => {
  function Journey() {
    const [open, setOpen] = useState(false);
    return <><button onClick={() => setOpen(true)}>Review airflows</button>{open && <ReviewSurface
      label="Update airflows" sentence="Change Supply" rows={Array.from({ length: 200 }, (_, i) => `Change ${i}`)}
      enabled confirm={() => { throw Error("Escape must not commit"); }} cancel={() => setOpen(false)} />}</>;
  }
  const view = render(<Journey />);
  const opener = screen.getByRole("button", { name: "Review airflows" });
  opener.focus();
  fireEvent.click(opener);
  const commit = await screen.findByRole("button", { name: "Commit Update airflows" });
  expect(view.container.contains(commit), "B04: review is portalled").toBe(false);
  expect(screen.getByText("Change 199"), "B04: final change is present").toBeTruthy();
  commit.focus();
  expect(document.activeElement).toBe(commit);
  fireEvent.keyDown(commit, { key: "Escape", code: "Escape" });
  await waitFor(() => expect(screen.queryByRole("button", { name: "Commit Update airflows" })).toBeNull());
  await waitFor(() => expect(document.activeElement, "B04: dismissal restores prior focus").toBe(opener));
  // Scroll reach and footer visibility require Driver layout evidence; jsdom cannot establish either.
});

test("JZ B02 undo follows focus between typed routes, portal and hidden pane; text keeps native undo", async () => {
  const live = mounts.mountTypedRoute;
  const owners: mounts.TypedMount[] = [];
  vi.spyOn(mounts, "mountTypedRoute").mockImplementation((...args) => {
    const owner = live(...args); owners.push(owner); return owner;
  });
  const make = (key: string) => route({ ...fans.spec, key, name: key, needs: "browser", core: undefined,
    subject: undefined, reads: {}, edits: undefined, commands: {}, fields: {},
    panes: { main: { title: key, purpose: "Focus ownership", draw: () => <><button>{key} focus</button><textarea aria-label={`${key} text`} />{createPortal(<button>{key} portal</button>, document.body)}</> } },
    layout: { kind: "pane", id: "main" } });
  const a = make("jz-a"), b = make("jz-b");
  const stamp = workFingerprintSchema.parse(`builtin-closure:${"a".repeat(64)}`);
  const address = () => ({ read: () => new URLSearchParams(), write: () => {}, subscribe: () => () => {} });
  const addressA = address(), addressB = address();
  function Journey() {
    const [hidden, setHidden] = useState(false);
    return <><button onClick={() => setHidden(true)}>Hide B</button><TypedShell module={a} fingerprint={stamp} address={addressA} />
      <RouteVisibility.Provider value={!hidden}><div hidden={hidden}><TypedShell module={b} fingerprint={stamp} address={addressB} /></div></RouteVisibility.Provider></>;
  }
  const root = createRootRoute({ component: Journey });
  const router = createRouter({ routeTree: root, history: createMemoryHistory({ initialEntries: ["/"] }) });
  render(<RouterProvider router={router} />);
  await screen.findByRole("button", { name: "jz-b focus" });
  expect(owners).toHaveLength(2);
  const undo = owners.map(owner => vi.spyOn(owner.history, "undo"));
  const press = (node: HTMLElement) => { node.focus(); const native = fireEvent.keyDown(node, { key: "z", code: "KeyZ", ctrlKey: true }); fireEvent.keyUp(node, { key: "z", code: "KeyZ", ctrlKey: true }); return native; };
  press(screen.getByRole("textbox", { name: "jz-a text" }));
  expect(undo.map(spy => spy.mock.calls.length), "B02: browser retains text undo").toEqual([0, 0]);
  press(screen.getByRole("button", { name: "jz-a focus" }));
  expect(undo.map(spy => spy.mock.calls.length), "B02: only the focused route receives undo").toEqual([1, 0]);
  press(screen.getByRole("button", { name: "jz-b portal" }));
  expect(undo.map(spy => spy.mock.calls.length), "B02: portal belongs to B").toEqual([1, 1]);
  fireEvent.click(screen.getByRole("button", { name: "Hide B" }));
  press(screen.getByRole("button", { name: "jz-a focus" }));
  expect(undo.map(spy => spy.mock.calls.length), "B02: hidden B cannot steal undo").toEqual([2, 1]);
});


// Chadds continuation at 2026-11-07T15:30:23Z: one human fan-flow edit, a refused
// missing parameter and ancillary loss/store writes. This is a reconstructed Plan,
// not a recovered native receipt. Keep this surface journey independent of run files.
import type { DuctsApply } from "@pe/host-contracts/generated";
import type { DuctSnapshot } from "@pe/ducts-domain/types";
import { inputsFor } from "@pe/ducts-domain/sheet/test-inputs";
import { lossPlanRefusal } from "../../../host/src/ducts-actions";
import { snapshot as ductsSeed } from "../ducts/test-fixture";
import { presentLosses } from "../ducts/reviews";
import { inputRows } from "../ducts/sheet/input-rows";
import { SheetCell } from "../ducts/sheet/sheet-cell";
import { writeHeld } from "../shell/admitted-chrome";
import { PreviewAction, WriteAction } from "@pe/kit/lang/write-action";

// Rule: refused human intent cannot authorize ancillary writes; review must name
// each element and its native stored setting, and disclose computed write-back.
test("JZ Fans Plan integrity: inspect refused flow and computed losses without authorizing Apply", () => {
  const fanId = 8775469;
  const slots = {
    fanStatic: "PE_M_Fan_ExternalStaticPressure", fanFlow: "PE_M_Fan_AirFlowDesign",
    componentDrop: "Pressure Drop", terminalDrop: "PE_M_Grd_ExternalStaticPressure",
    fittingCoefficient: "Pe_C", terminalFlow: "PE_M_Grd_AirFlow",
  };
  const snapshot: DuctSnapshot = {
    ...ductsSeed, slots,
    levels: [{ id: 1, name: "Level 1", elevationFt: 0 }, { id: 2, name: "Level 2", elevationFt: 10 }],
    nodes: [
      { id: fanId, kind: "equipment", category: "Mechanical Equipment", label: "MUAS-1",
        type: "MUAS 10", family: "Fantech", flowParameter: null, connectors: [], facts: [] },
      { id: 2, kind: "accessory", type: '10"', category: "Duct Accessories", partType: "Damper",
        levelId: 1, connectors: [], facts: [],
        loss: { method: "ashrae-table", coefficient: 0.19, table: "CD9-1", fields: {} } },
      { id: 3, kind: "accessory", type: '10"', category: "Duct Accessories", partType: "Damper",
        levelId: 2, connectors: [], facts: [] },
    ], segments: [],
  };
  const writes: DuctsApply.Res.Response["writes"] = [
    { id: 2, kind: "component", outcome: "planned", before: "unset", after: "0.0398 in-wg", parameter: "Specific Loss" },
    { id: fanId, kind: "equipment-flow", outcome: "refused", before: null,
      reason: "neither the instance nor its type has 'PE_M_Fan_AirFlowDesign'" },
    ...Object.entries(slots).map(([key, after]) => ({ kind: "slot", key, before: null, after, outcome: "planned" })),
    { kind: "store", before: "absent", after: "revision 1", outcome: "planned" },
    { kind: "store", key: "instances", before: null, after: "updated", outcome: "planned" },
  ];
  const refusal = lossPlanRefusal(writes);
  const preview = {
    previewOnly: true,
    seal: { caller: { kind: "human", via: "local" }, requestHash: "fans-plan-integrity",
      work: {}, documentMark: { session: "recorded-chadds", openId: "chadds", observedSince: 1, changedAt: 1 },
      incarnation: null, dependencies: "recorded-chadds" },
    ...(refusal ? { planRefusal: `MUAS-1: ${refusal}; add the parameter to the family or map flow to an existing parameter` } : {}),
    value: { writes, counts: { planned: 9, refused: 1, unchanged: 0, written: 0 } },
    derivedRequest: { slots, equipmentFlows: [{ id: fanId, cfm: 1000 }],
      components: [{ id: 2, inWg: 0.0398, source: "damper CD9-1 C=0.19" }] },
  };
  const review = presentLosses(preview, { readings: { sheetSnapshot: { value: snapshot } } });
  const held = writeHeld("Write to Revit", { ...review, preview, stale: false });
  const apply = vi.fn(async () => null);
  render(<WriteAction label="Plan fan writes" says="Plan current Work" held={held.held}
    plan={async () => null} apply={{ label: "Write to Revit", says: "Apply the Plan",
      refusal: held.sealed ? null : "MUAS-1 has no writable PE_M_Fan_AirFlowDesign parameter", run: apply, done: "Written" }} />);
  fireEvent.click(screen.getByRole("button", { name: /planned/ }));
  const commit = screen.getByRole("button", { name: "Write to Revit" });
  fireEvent.click(commit);
  expect.soft(apply, "atomic intent: the admitted chrome cannot apply the refused Plan").not.toHaveBeenCalled();
  expect.soft(held.sealed, "atomic intent: bookkeeping cannot arm Apply").toBe(false);
  expect.soft(document.body.textContent, "refusal names the human edit and its remedy").toMatch(/MUAS-1.*PE_M_Fan_AirFlowDesign[\s\S]*add the missing parameter/);
  expect.soft(screen.queryByText("Computed losses written back"), "derived losses have their own heading").not.toBeNull();
  expect.soft(screen.queryByText("Pe loss record"), "bookkeeping has its own heading").not.toBeNull();
  expect.soft(document.body.textContent, "before is the native stored setting, not the snapshot coefficient").toContain("unset");
  const labels = review.cells.filter(cell => cell.key.startsWith("component:")).map(cell => cell.label);
  expect.soft(labels[0], "a size-only type names the damper and its level").toMatch(/damper.*Level 1/i);
  expect.soft(document.body.textContent, "write review exposes a searchable element identity").toContain(String(fanId));
  cleanup();

  // The shared review entry point must refuse too, even for older results with no planRefusal field.
  const { planRefusal: _reason, ...legacyPreview } = { planRefusal: undefined, ...preview };
  render(<PreviewAction label="Write to Revit" handle={{ read: () => ({ ...review, preview: legacyPreview, stale: false }),
    plan() {}, apply, cancel() {} }} />);
  fireEvent.click(screen.getByRole("button", { name: /planned/ }));
  expect.soft(screen.queryByRole("button", { name: "Write to Revit" }), "a mixed native result exposes no Apply").toBeNull();
  cleanup();

  const rows = inputRows({ snapshot, doc: null, fanUnitId: fanId, inputs: inputsFor(snapshot) });
  const control = rows.find(row => row.key === `unit:${fanId}:cfm`)!.control;
  if (control.kind !== "number") throw Error("Unit airflow is not a number cell");
  // Base has no refusal member: the cast lets the same journey reach its DOM falsifier there.
  const editRefusal = (control as typeof control & { refusal?: string }).refusal ?? null;
  render(<SheetCell label="MUAS-1 flow" value={control.value} unit={{ label: "cfm" }} digits={0}
    source="none" refusal={editRefusal} onValue={apply} />);
  expect.soft(document.querySelector('[data-body="locked"]'), "missing parameter locks the edit before Plan").not.toBeNull();
  expect.soft(document.body.innerHTML, "the edit-time explanation identifies the missing slot").toContain("PE_M_Fan_AirFlowDesign");
});
// Plan reviews seal model inputs, never browser pane visibility or Page pose.
import { useEffect, useReducer } from "react";
import realMuas from "../../../../packages/ducts-domain/src/sheet/fixtures/muas-local-20261102.json";
import { createWitness } from "../fans/cutover.test-support";
import { StateCell } from "@pe/kit/lang/cell";
import { actionStatusSchema } from "@pe/agent-contracts";
import type { ReceiptFeedState, ReceiptCursor } from "../../../../packages/agent-contracts/src/work-journal-door";
import { TypedWrite } from "../shell/typed-shell";
import type { ReadingDelivery } from "../shell/source-contract";
const native = vi.hoisted(() => ({ submit: vi.fn(), permission:vi.fn(), retained: [] as unknown[] }));
vi.mock("../../../../packages/mcps/src/shared/takeoff-action-client", async (actual) => ({
  ...(await actual<object>()),
  submitAction: native.submit,
}));

vi.mock("../workbench/provider/harness-client",()=>({harnessClient:()=>({permission:native.permission})}));

const closes: (() => void)[] = [];
afterEach(() => {
  cleanup();
  closes
    .splice(0)
    .reverse()
    .forEach((close) => close());
});

// CB4-F01: replay the recorded MUAS walk through Work, Plan and the shared review DOM.
// Native responses use the new DTO; they certify presentation, not a Revit read.
test("JZ Fans native before: stage, Plan, inspect method and unset pressure; unreadable holds Apply", async () => {
  for (const unreadable of [false, true]) {
    const capture = structuredClone(realMuas);
    native.submit.mockImplementation(async () => {
      const input = f.inputs.get("fans:ducts.plan-losses") as { work: unknown };
      return ({
      id: "native-before-plan", state: "succeeded",
      result: {
        previewOnly: true,
        derivedRequest: {
          components: [{ id: 14607308, inWg: 0.03980584344921083, source: "damper CD9-1" }],
          equipmentFlows: [{ id: 14577391, cfm: 1000, source: "Work" }],
        },
        takenAt: "2026-11-07T19:06:18.171Z",
        seal: {
          caller: { kind: "human", via: "local" }, requestHash: "sealed", work: { handle: input.work },
          documentMark: { session: "fixture", openId: "fans", observedSince: null, changedAt: null },
          incarnation: {}, dependencies: "exact",
        },
        value: {
          previewOnly: true,
          writes: [{
            id: 14607308, kind: "component", outcome: unreadable ? "refused" : "planned",
            elementLabel: 'Mechanical Damper 10"', uniqueId: "cd545b04-afd3-4993-836f-9b3d8116003a-00dee3cc",
            parameter: "Specific Loss", scope: "instance",
            before: unreadable ? null : "unset", after: unreadable ? null : "0.0398 in-wg",
            reason: unreadable ? "Revit refused the read: element is inaccessible" : null,
            changes: unreadable ? null : [
              { parameter: "Loss Method", before: "ashrae-table", after: "specific-loss" },
              { parameter: "Specific Loss", before: "unset", after: "0.0398 in-wg" },
            ],
            reportedPressureDropInWg: unreadable ? null : 0.025,
          }, {
            id: 14577391, kind: "equipment-flow", outcome: "planned",
            elementLabel: "MUAS-1", uniqueId: "78fb66ed-41aa-47c4-907e-6ccf601ad7b3-00de62f1",
            parameter: "PE_M_Fan_AirFlowDesign", scope: "instance",
            before: "880 cfm", after: "1000 cfm",
          }],
          counts: { planned: unreadable ? 1 : 2, refused: unreadable ? 1 : 0, written: 0, unchanged: 0 },
          storeRevision: 0, systemsAfter: null,
        },
      },
    }); });
    const f = await createWitness(closes, new Map(), {
      "ducts.sheet-snapshot": { kind: "use", open(_ctx, deliver) {
        deliver({ kind: "complete", value: capture, revision: 1 });
      } },
    });
    await vi.waitFor(() => expect(f.fans.work()).not.toBeNull());
    await f.ws.apply(f.fans.workBasis()!.token.scope.identity.work!, "fans", "human", [
      { path: ["writeIntent"], value: { edit: { value: { walk: { unitId: 14577391, portIndex: 2 } } } } },
      { path: ["equipmentFlows", "14577391", "edit"], value: { value: { cfm: 1000, source: "Work" } } },
    ], f.fans.work()!.revision);
    await vi.waitFor(() => expect(f.fans.work()!.value.equipmentFlows["14577391"]?.edit?.value.cfm).toBe(1000));
    f.fans.refresh("value");
    for (const id of ["value", "owner:ducts"])
      await vi.waitFor(() => expect(f.fans.readingStatus(id).snapshot).toMatchObject({ current: true }));
    function WriteReview() {
      const [, changed] = useReducer(n => n + 1, 0);
      useEffect(() => f.fans.subscribe(changed), []);
      return <TypedWrite mount={f.typed} id="losses" />;
    }
    render(<WriteReview />);
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "plan Write to Revit" })));
    await waitFor(() => expect(f.fans.review("losses")?.cells?.length).toBeGreaterThan(0));
    const reviewTrigger = screen.getByRole("button", { name: /Write to Revit.*planned/ });
    if (reviewTrigger.getAttribute("aria-expanded") !== "true")
      await act(async () => fireEvent.click(reviewTrigger));
    const rows = [...document.querySelectorAll("[data-write-cell]")].map(row => row.textContent!);
    if (unreadable) {
      expect.soft(rows.some(row => row.includes('Mechanical Damper 10"') && row.includes("14607308") && row.includes("Specific Loss") && row.includes("element is inaccessible"))).toBe(true);
      expect.soft(screen.queryByRole("button", { name: "Write to Revit" }), "unreadable native target holds the entire intent").toBeNull();
    } else {
      for (const words of [
        ['Mechanical Damper 10"', "14607308", "Loss Method", "ASHRAE table", "Specific Loss"],
        ['Mechanical Damper 10"', "14607308", "Specific Loss", "unset", "0.0398 in-wg", "reported effective pressure", "0.025 in-wg"],
        ["MUAS-1", "14577391", "PE_M_Fan_AirFlowDesign", "instance", "880 cfm", "1000 cfm"],
      ]) expect.soft(rows.some(row => words.every(word => row.includes(word))), words.join(" / ")).toBe(true);
      expect.soft(rows).toHaveLength(3);
      expect.soft(screen.getByRole("button", { name: "Write to Revit" }).hasAttribute("disabled")).toBe(false);
    }
    cleanup();
    closes.splice(0).reverse().forEach(close => close());
  }
});

test.each([false, true])(
  "JZ Plan pane/pose: pending Fans review stays Apply-eligible without Work revisions (oversized reading: %s)",
  async (large) => {
    native.retained.length = 0;
    const capture = structuredClone(realMuas);
    if (large) capture.document.title = "large-model-evidence".repeat(65536);
    const bytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).byteLength;
    if (large) expect(bytes(capture)).toBeGreaterThan(1024 * 1024);
    let plan!: (result: unknown) => void;
    const snapshots: ReadingDelivery[] = [];
    const snapshot:ReadingDelivery = frame => snapshots.forEach(deliver=>deliver(frame));
    native.submit.mockImplementation(
      () =>
        new Promise((resolve) => {
          plan = resolve;
        }),
    );
    native.permission.mockClear();
    const receiptSubscribers=new Set<(state:ReceiptFeedState)=>void>();
    const receipts:WorkJournalDoor["receipts"]=()=>({subscribe(deliver){receiptSubscribers.add(deliver);return ()=>{receiptSubscribers.delete(deliver);};}});
    const f = await createWitness(closes, new Map(), {
      "ducts.sheet-snapshot": {
        kind: "use",
        open(_ctx, deliver) {
          snapshots.push(deliver);
          deliver({ kind: "complete", value: capture, revision: 1 });
        },
      },
    },undefined,receipts);
    await vi.waitFor(() => expect(f.fans.work()).not.toBeNull());
    const key = f.fans.workBasis()!.token.scope.identity.work!;
    await f.ws.apply(
      key,
      "fans",
      "pea",
      [
        {
          path: ["writeIntent"],
          value: { edit: { value: { walk: { unitId: 14577391, portIndex: 2 } } } },
        },
        {
          path: ["equipmentFlows", "14577391", "edit"],
          value: { value: { cfm: 925, source: "test" } },
        },
      ],
      f.fans.work()!.revision,
    );
    await vi.waitFor(() => expect(f.fans.work()!.value.writeIntent).toBeTruthy());
    f.fans.refresh("value");
    for (const id of ["value", "owner:ducts"])
      await vi.waitFor(() => {
        const snapshot = f.fans.readingStatus(id).snapshot;
        if (snapshot.status === "failed") throw Error(`${id}: ${snapshot.reason}`);
        expect(snapshot).toMatchObject({ current: true });
      });
    function Write() {
      const [, changed] = useReducer((n) => n + 1, 0);
      useEffect(() => f.fans.subscribe(changed), []);
      return <TypedWrite mount={f.typed} id="losses" />;
    }
    render(<Write />);
    await act(async () =>
      fireEvent.click(screen.getByRole("button", { name: "plan Write to Revit" })),
    );
    // The native mount retains handles and hash dependencies; it never serializes a Value into a token.
    expect(bytes(f.fans.workBasis())).toBeLessThan(2048);
    expect(plan).toBeTypeOf("function");
    const input = f.inputs.get("fans:ducts.plan-losses") as { work: unknown; readWorks: unknown };
    expect(input.readWorks).toHaveProperty("fans");
    // H1: a plan the host refuses after invoke returned shows its reason, arms nothing, and retries clean.
    const refusedText = "Fans Work belongs to another document";
    await act(async () => plan({ id: "plan-refused", state: "refused", error: refusedText }));
    expect(document.querySelector("[data-write-outcome=refused]")?.textContent).toBe(refusedText);
    expect(screen.queryByRole("button", { name: "Write to Revit" })).toBeNull();
    const trigger = screen.getByRole("button", { name: "plan Write to Revit" });
    await act(async () => fireEvent.click(trigger));
    await act(async () => fireEvent.click(trigger));
    expect(f.fans.reviewRefusal("losses")).toBeNull();
    expect(document.body.textContent).not.toContain(refusedText);
    const stagedRevision = f.fans.work()!.revision;
    const beforeSwitch = f.typed.value().publication!.evaluation;
    const beforeReads = f.calls.get("fans:fans.sheet");
    // The shell releases the retained typed mount while another pane is expanded.
    await act(async () => {
      f.typed.release();
      f.typed.subscribe(() => {})();
      f.typed.page.pose({ layers: [] });
    });
    expect(f.fans.work()!.revision).toBe(stagedRevision);
    expect(f.calls.get("fans:fans.sheet")).toBeGreaterThan(beforeReads!);
    await waitFor(() => expect(f.typed.value().current).toBe(true));
    expect(f.typed.value().publication!.evaluation).toBe(beforeSwitch);
    await act(async () =>
      plan({
        id: "plan-retention",
        state: "succeeded",
        result: {
          previewOnly: true,
          takenAt: "2026-11-05T00:00:00Z",
          derivedRequest: { equipmentFlows: [{ id: 14577391, cfm: 925, source: "test" }] },
          seal: {
            caller: { kind: "human", via: "local" },
            requestHash: "sealed",
            work: { handle: input.work },
            documentMark: {
              session: "fixture",
              openId: "fans",
              observedSince: null,
              changedAt: null,
            },
            incarnation: {},
            dependencies: "exact",
          },
          response: {
            writes: [
              {
                id: 14577391,
                kind: "equipment-flow",
                outcome: "planned",
                before: "880 cfm",
                after: "925 cfm",
              },
            ],
            counts: { planned: 1, written: 0, refused: 0, unchanged: 0 },
          },
        },
      }),
    );
    expect(f.fans.review("losses")).toMatchObject({
      stale: false,
      cells: [{ before: "880 cfm", author: "human" }],
    });
    expect(f.fans.review("losses")!.rows[0]).toContain("MUAS-1");
    expect(f.typed.action("losses").read()?.preview).toBeTruthy();
    const reviewTrigger = screen.getByRole("button", { name: /Write to Revit.*planned/ });
    if (reviewTrigger.getAttribute("aria-expanded") !== "true")
      await act(async () => fireEvent.click(reviewTrigger));
    expect((await screen.findByRole("button", { name: "Write to Revit" })).hasAttribute("disabled")).toBe(false);
    expect(document.querySelector("[data-write-cell]")?.textContent).toContain("925 cfm");
    expect(f.fans.work()!.revision).toBe(stagedRevision);
    // Broad route-surface witness: the real typed action consumes its receipt feed, and the
    // consent review contains the exact owned Work cell rather than a parallel fake handle.
    const receipt=actionStatusSchema.parse({id:"consent-review",key:"ducts.apply-losses",state:"waiting",
      caller:{kind:"pea",thread:"consent-thread",context:"surface-test"},basis:null,target:{kind:"host"},input:{},startedAt:new Date().toISOString(),
      consentWindow:{requestId:"consent-request",deadline:new Date(Date.now()+60_000).toISOString()}});
    act(()=>{for(const deliver of receiptSubscribers)deliver({kind:"ready",receipts:{rows:[receipt],from:0 as ReceiptCursor,through:1 as ReceiptCursor}});});
    expect(f.typed.action("losses").consent).not.toBeNull();
    cleanup();
    function ConsentReview(){return <PreviewAction handle={f.typed.action("losses")} label="Write to Revit">
      {f.typed.draw("sheet-inputs",ctx=><StateCell label="Equipment flow" cell={ctx.cells.at(["equipmentFlows","14577391"],"fans",{
        format:value=>typeof value==="object"&&value!==null&&"cfm" in value?String(value.cfm):String(value),
      })}/> ) as import("react").ReactNode}
    </PreviewAction>;}
    render(<ConsentReview/>);
    await act(async()=>fireEvent.click(screen.getByRole("button",{name:/Write to Revit.*planned/})));
    expect(screen.getByDisplayValue("925")).toBeTruthy();
    expect(screen.queryByRole("button",{name:"Write to Revit"})).toBeNull();
    fireEvent.click(document.querySelector("[data-write-reject]")!);
    expect(native.permission).toHaveBeenCalledWith("consent-thread","consent-request","stop_writes");
    // New naming evidence must revoke the old before/after review rather than silently re-present it.
    const moved = structuredClone(capture);
    moved.document.title = "changed model evidence";
    act(() => {
      f.fans.refresh("value");
      snapshot({ kind: "complete", value: moved, revision: 2 });
    });
    expect(f.fans.review("losses")).toMatchObject({ stale: true, rows: [], cells: [] });
    expect(() => f.fans.confirm("losses")).toThrow(/stale/i);
  },
);
test("JZ B03 people choose named subjects: pending Families scope, cold Schedules picker and honest Read", async () => {
  await pendingFamiliesChoice();
  const host = await scheduleHost();
  host.addSchedule(43, "ElectricDuctHeater");
  // Replay the native boundary for the unstarted member, not the fixture's seeded Panel Work.
  const { detailResponse } = await import("../../../host/tests/schedule-fixture");
  const heater = detailResponse();
  Object.assign(heater.entries[0]!, { scheduleId: 43, scheduleUniqueId: "uid-43", scheduleName: "ElectricDuctHeater" });
  heater.entries[0]!.rows[0]!.values[0] = "SH1";
  heater.entries[0]!.rows.push({ ...structuredClone(heater.entries[0]!.rows[0]!), rowNumber: 2, values: ["SH2", "100 VA"] });
  host.setDetail(heater);
  const pending = new Set<Promise<void>>();
  const source: UseSource = {
    kind: "use",
    open(ctx, deliver) {
      const task = host.post("/pe/reads/value", {
        read: "schedules.view", subscription: crypto.randomUUID(), generation: 1,
        args: { target: host.b, ...(ctx.args as Record<string, unknown>) },
      }).then(response => {
        expect(response.status).toBe(200);
        if (!ctx.signal.aborted) deliver({ kind: "complete", value: response.value, revision: 1 });
      }).catch(error => { if (!ctx.signal.aborted) deliver({ kind: "failure", error }); });
      pending.add(task);
      void task.finally(() => pending.delete(task));
      return () => {};
    },
  };
  // Receipt SSE is outside B03; commands still settle against the real host ActionJournal.
  const native = createWorkFeedClient({ subscribe: () => () => {}, dirty() {} }, {
    write: async () => { throw Error("B03 does not edit Work"); },
    submit: async command => {
      const response = await host.post("/actions", command);
      if (response.status >= 400) throw Error(JSON.stringify(response.value));
      return host.owner().wait(command.id);
    },
  });
  // This fixture serves persisted Work over HTTP, without a browser admission registry.
  // Replay that transport boundary; never substitute a seed or revision for the host's answer.
  const work: WorkJournalDoor = {
    ...native,
    open: scope => ({ subscribe(deliver, end) {
      let closed = false;
      const task = host.view(scope.key.work).then(state => {
        // The HTTP inspection door returns schema defaults at r0 for absent Work.
        if (state.revision === 0) { if (!closed) deliver({ kind: "absent" }); return; }
        if (!closed) deliver({ kind: "ready", history: { from: 0, acks: [] }, snapshot: {
          handle: { key: scope.key, revision: state.revision }, revision: state.revision, value: state.doc,
        } });
      }).catch(error => {
        if (!closed) { deliver({ kind: "failed", failure: { kind: "failed", code: "WorkReadFailed", message: String(error) } }); end(); }
      });
      pending.add(task); void task.finally(() => pending.delete(task));
      return () => { closed = true; };
    } }),
  };
  let search = new URLSearchParams();
  const fingerprint = workFingerprintSchema.parse(`builtin-closure:${"a".repeat(64)}`);
  const mount = mounts.mountTypedRoute(schedules, {
    address: { read: () => new URLSearchParams(search), write: next => { search = new URLSearchParams(next); }, subscribe: () => () => {} },
    fixture: null, target: { kind: "document", ref: host.b }, work: { address: null, open: host.b },
    custody: { current: () => true }, memory: () => ({}),
  }, fingerprint, { work, sources: { "schedules.view": source } });
  function Journey() {
    useSyncExternalStore(mount.subscribe, mount.revision, mount.revision);
    return <KeyScopeHost id="b03-schedules"><TypedChrome mount={mount} document={<span>Project schedules</span>} /></KeyScopeHost>;
  }
  const root = createRootRoute({ component: Journey });
  const router = createRouter({ routeTree: root, history: createMemoryHistory({ initialEntries: ["/schedules"] }) });
  const view = render(<RouterProvider router={router} />);
  try {
    await waitFor(() => expect(mount.value().current).toBe(true));
    expect(mount.work(), "B03: catalogue discovery does not require selected Work").toBeNull();
    await waitFor(() => expect(screen.getAllByRole("button", { name: "Read schedule" })).toHaveLength(2));
    await act(async () => { fireEvent.click(screen.getAllByRole("button", { name: "Read schedule" }).at(-1)!); });
    expect(screen.getAllByText("Choose a schedule before reading").length, "B03: refused Read is visible").toBeGreaterThan(0);
    expect.soft(screen.queryAllByText(/.+ complete$/i), "B03: a refused verb must never produce any completion receipt").toEqual([]);
    const chooser = screen.queryByRole("button", { name: "Choose schedule" });
    expect.soft(chooser, "B03: cold open exposes the declared named-subject picker").not.toBeNull();
    if (!chooser) return; // Both base defects above remain assertion failures, not a missing-control exception.
    fireEvent.click(chooser);
    expect(await screen.findByRole("option", { name: "ElectricDuctHeater" }), "B03: choices come from the host catalogue").toBeTruthy();
    fireEvent.click(screen.getByRole("option", { name: "ElectricDuctHeater" }));
    const chosen = namesOf(mount.page.read().workspaceId);
    expect(chosen).not.toEqual([host.scope.work]);
    expect(search.has("workspaceId"), "B03: picker creates the Page address without a URL seed").toBe(true);
    await screen.findByRole("button", { name: "Start" });
    await waitFor(() => expect(mount.value().current).toBe(true));
    const before = host.reads();
    await act(async () => { fireEvent.click(screen.getAllByRole("button", { name: "Read schedule" }).at(-1)!); });
    expect.soft(screen.queryAllByText("Start this schedule Work before reading").length,
      "B03: a chosen but unstarted schedule names Start").toBeGreaterThan(0);
    expect.soft(screen.queryAllByText(/choose a schedule before reading|no schedule open/i),
      "B03: a selected schedule never asks to choose again").toEqual([]);
    expect(host.reads(), "B03: refused Read dispatches no native detail").toBe(before);
    expect(mount.work(), "B03: Read cannot implicitly Start").toBeNull();
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Start" })); });
    await waitFor(() => expect(mount.work()).not.toBeNull());
    expect([mount.work()!.handle.key.work]).toEqual(chosen);
    await waitFor(() => expect(mount.value().current).toBe(true));
    await act(async () => { fireEvent.click(screen.getAllByRole("button", { name: "Read schedule" }).at(-1)!); });
    await waitFor(() => expect(host.reads(), "B03: Read reaches native schedule detail").toBeGreaterThan(before));
    await waitFor(() => expect(mount.result("read")).toBeDefined());
    await waitFor(() => {
      expect(mount.value().current, "B03: Read publishes a current Value").toBe(true);
      expect(mount.value().value?.reading, "B03: publication contains the completed Read, not the old capture").toEqual(mount.result("read"));
    });
    expect(mount.action("read").failure).toBeNull();
    expect(mount.value().value?.reading?.snapshot.scheduleId).toBe(43);
    expect(mount.value().value?.reading?.snapshot.scheduleName).toBe("ElectricDuctHeater");
    expect(host.sent.filter(row => row.key === "revit.detail.schedules").at(-1)?.input)
      .toMatchObject({ query: { kind: "ScheduleReferences", scheduleIds: [43] } });
    // TypedChrome mounts the shipped pane: members must reach the grid.
    await screen.findByText("SH1");
    await screen.findByText("SH2");
    expect(screen.getAllByRole("button", { name: "Choose schedule" }), "B03: one declared subject control").toHaveLength(1);
    expect(view.container.textContent, "B03: people see names, not internal Work identities").not.toContain(host.scope.work);
  } finally {
    view.unmount(); mount.dispose(); await Promise.all(pending);
  }
}, 30_000);


/** Retained Families publication + ready Work reproduce the Driver's post-Start refresh. */
async function pendingFamiliesChoice() {
  const doc = familiesRouteState.schema.parse({});
  const catalogue = {
    summary: { totalFamilies: 1, placedFamilies: 0, unplacedFamilies: 1, totalTypes: 1, totalPlacedInstances: 0, truncated: false },
    families: [{ familyId: 1, familyUniqueId: "air-tag", familyName: "Air Terminal Tag", categoryName: "Air Terminal Tags", typeCount: 1, placedInstanceCount: 0, types: [{ typeName: "Standard" }] }],
    issues: [],
  };
  // Only this retained publication boundary is replayed. Schedules below retains its real host HTTP reads/actions.
  const packet = families.spec.core!.output.parse({
    key: "b03-families", generation: 1, version: 1, state: "current", value: {
      data: { familiesWork: doc, catalog: catalogue, categories: ["Air Terminal Tags"], observation: null,
        rows: [], params: [], pivotRows: [], pivotFamilies: [], outcomes: [], activeReadId: null, editRefusal: "Read these families before editing" },
      evaluation: "b03-families", inputs: "b03-families", coverage: { requested: [], covered: [], unknown: [], refused: [] },
      origin: { kind: "fixture", name: "post-start-families" }, trace: [], freshness: "current",
    },
  });
  const release = Promise.withResolvers<void>();
  let hold = false;
  const tasks = new Set<Promise<void>>();
  const source: UseSource = { kind: "use", open(ctx, deliver) {
    const task = (hold ? release.promise : Promise.resolve()).then(() => {
      if (!ctx.signal.aborted) deliver({ kind: "complete", value: packet, revision: 1 });
    });
    tasks.add(task); void task.finally(() => tasks.delete(task));
    return () => {};
  } };
  let search = new URLSearchParams();
  const mount = mounts.mountTypedRoute(families, {
    address: { read: () => new URLSearchParams(search), write: next => { search = new URLSearchParams(next); }, subscribe: () => () => {} },
    fixture: null, target: { kind: "document", ref: { session: "b03-families", openId: "project" } },
    work: { address: address("C:/Models/B03-Families.rvt"), open: null }, custody: { current: () => true }, memory: () => ({}),
  }, workFingerprintSchema.parse(`builtin-closure:${"a".repeat(64)}`), {
    work: createFixtureWorkDoor(familiesRouteState, doc), sources: { "families.view": source },
  });
  function Journey() {
    useSyncExternalStore(mount.subscribe, mount.revision, mount.revision);
    return <KeyScopeHost id="b03-families"><TypedChrome mount={mount} document={<span>Families after Start</span>} /></KeyScopeHost>;
  }
  const root = createRootRoute({ component: Journey });
  const router = createRouter({ routeTree: root, history: createMemoryHistory({ initialEntries: ["/families"] }) });
  const view = render(<RouterProvider router={router} />);
  try {
    await screen.findByRole("button", { name: "Choose Air Terminal Tags" });
    await waitFor(() => expect(mount.work()).not.toBeNull());
    await waitFor(() => expect(mount.value().current).toBe(true));
    hold = true;
    await act(async () => mount.refresh());
    expect(mount.value(), "B03 Families: pending refresh retains named choices").toMatchObject({ status: "pending", current: false });
    const before = { work: mount.work(), page: mount.page.read(), url: search.toString() };
    const category = screen.getByRole("button", { name: "Choose Air Terminal Tags" });
    const member = screen.getByRole("button", { name: "Choose Air Terminal Tag" });
    expect.soft(category.getAttribute("aria-disabled"), "B03 Families: pending category is visibly disabled, not a swallowed choice").toBe("true");
    expect.soft(member.getAttribute("aria-disabled"), "B03 Families: the same refusal governs family choices").toBe("true");
    expect.soft(screen.queryByText("Family scope unavailable"), "B03 Families: scope refusal is visible before interaction").not.toBeNull();
    const group = screen.getByRole("group", { name: "Family scope" });
    expect.soft(group.textContent, "B03 Families: scope refusal names the pending Reading").toContain("Reading...");
    await act(async () => { fireEvent.click(category); fireEvent.click(member); });
    expect({ work: mount.work(), page: mount.page.read(), url: search.toString() }, "B03 Families: a refused choice commits nothing").toEqual(before);
    expect(familiesRouteState.schema.parse(mount.work()?.value).scope.edit, "B03 Families: no category was queued secretly").toBeUndefined();
    await act(async () => { release.resolve(); });
    await waitFor(() => expect(mount.value().current).toBe(true));
    expect(screen.getByRole("button", { name: "Choose Air Terminal Tags" }).getAttribute("aria-disabled"), "B03 Families: current basis re-enables scope choices").not.toBe("true");
    expect(familiesRouteState.schema.parse(mount.work()?.value).scope.edit).toBeUndefined();
  } finally { release.resolve(); view.unmount(); mount.dispose(); await Promise.all(tasks); }
}
test("JZ H01 H17 saved takeoff choice preserves authored Work and live Initialize while History captures", async () => {
  const j = await takeoffJourney();
  try {
    await j.ready();
    expect((await j.host.journal.list()).some(row => row.key === "work.start" && row.state === "succeeded"), "ordinary Start crossed the real /actions handler").toBe(true);
    const originalWork = j.mount.owner()!.handle;
    expect(originalWork).toBeTruthy();
    render(<TakeoffDrawing mount={j.mount} />);
    fireEvent.click(screen.getByRole("button", { name: "Choose views" }));
    fireEvent.click(await screen.findByRole("option", { name: "Zoning plan" }));
    await waitFor(() => expect(j.mount.value().current).toBe(true), {timeout:20000});
    await waitFor(() => expect(j.mount.owner()?.ready || j.mount.owner()?.absent).toBe(true));
    expect(j.mount.owner()!.handle, "H01: view choice cannot select another Work through serialized Page fields").toEqual(originalWork);
    await j.ready();
    const capture = adoptionData.parse(j.mount.value().value).captures[0]!;
    fireEvent.click(screen.getByRole("button", { name: "Choose capture" }));
    const option = (await screen.findAllByRole("option")).find(row => row.textContent?.includes(capture.capturedAt));
    expect(option, "choose this exact saved capture").toBeTruthy();
    fireEvent.click(option!);
    await waitFor(() => expect(j.mount.value().current).toBe(true), {timeout:20000});
    await waitFor(() => expect(j.mount.owner()?.ready || j.mount.owner()?.absent).toBe(true));
    expect(screen.getByText(/Archived takeoff/)).toBeTruthy();
    expect(j.mount.owner()!.handle, "H01: a saved-evidence id cannot select another Work").toEqual(originalWork);
    expect(j.host.inputs.source).toMatchObject({capturing:true});
    fireEvent.click(screen.getByRole("button", {name:"live"}));
    await j.ready();
    await screen.findByRole("checkbox", {name:"Select Office zone in Zoning plan"});
    expect(j.mount.owner()!.handle).toEqual(originalWork);
    expect((screen.getByRole("button", {name:"initialize"}) as HTMLButtonElement).disabled, "H17: live readiness uses the current document and its original Work").toBe(false);
    expect(j.mount.value().value.initialize.refusal).toBeNull();
    expect(j.host.inputs.source).toMatchObject({capturing:true});
    expect(j.host.inputs.lane.kind).toBe("live");
    if(j.host.inputs.lane.kind === "live")
      expect(j.host.inputs.lane.captureStore!.capture.truncated(), "zero capture stops").toBeNull();
  } finally { await j.close(); }
}, 60000);
// Only the conversation/reading boundaries are recorded. RouteDock, Activity, typed Family,
// Work feeds, file persistence and the Host view HTTP handler remain production owners.
const conversation = vi.hoisted(() => ({ value: null as unknown }));
vi.mock("../workbench/provider", () => ({ useWorkbench: () => conversation.value }));
vi.mock("../chat/chat-shell", () => ({ ChatShell: () => null }));

test("JZ B05 retain Family Work and its spec across folding, first-thread promotion and thread switches", async () => {
  const [{ createRoute }, { RegistryContext }, { appAtomRegistry }, { RouteDock },
    { createChatPageStore }, { module: family }, { publicRoutes }, { peClient },
    { createPeClient }, { peReadings }, { observeResources }, { createPeRoutes },
    { fileRouteDocumentStore }, { fixture, who }, { withInvocationContext },
    { bindWork, workKey, familyDraftSchema }, { rememberPlace },
    { readThreadWork }, { chatPluginTitle }] = await Promise.all([
      import("@tanstack/react-router"), import("@effect/atom-react"), import("../shell/owner"),
      import("../workbench/route-panes"), import("../workbench/store"), import("../family/route"),
      import("./route-discovery"), import("../host/pe-client"), import("@pe/agent-contracts/pe-api"),
      import("../host/resource-stream"), import("@pe/runtime"), import("../../../host/src/pe-routes"),
      import("../../../host/src/route-document-store"), import("../../../host/tests/host-read-graph.test-support"),
      import("@pe/runtime/context"), import("@pe/agent-contracts"),
      import("../../../host/src/thread-work-context"), import("../../../host/src/navigation"),
      import("../workbench/chat-plugins"),
    ]);
  const { join } = await import("node:path");
  // Import the shipped root, not builtin-routes: the root must actually bootstrap discovery.
  await import("../routes/__root");
  const host = await fixture();
  await host.send(0, []);
  const api = createPeRoutes({ workspace: host.workspace, registrations: [] });
  const key = bindWork("family", null);
  const member = { pod: "family-context-journey", path: "settings/family/silencer.json" };
  const doc = familyDraftSchema.parse({ reading: "captured-family", spec: { member, doc: {
    jobId: "retained-spec", fileName: "retained-spec.pdf", images: [],
    pages: [{ page: 1, width: 612, height: 792, screenshotUrl: null, markdown: "Retained specification" }],
    blocks: [{ id: "page-1-block-1", page: 1, kind: "text", md: "Retained specification", bboxes: [] }],
  } } });
  await fileRouteDocumentStore(join(host.dir, "work")).setState({ targetKey: workKey(key), route: "family",
    value: { version: 1, schemaVersion: 1, revision: 3, doc, history: [] } });
  const transport = createPeClient("", (input, init) => withInvocationContext({ caller: who }, () =>
    api.fetch(new Request(new URL(String(input), "http://host"), init))));
  vi.spyOn(peClient, "call").mockImplementation(transport.call);
  vi.spyOn(peReadings, "subscribe").mockImplementation(observeResources(host.workspace, { observe: () => () => {} }));
  // No native or provider turn is needed to address existing Work. Keep Value unavailable.
  vi.spyOn(await import("../shell/host-read-source"), "hostReadSource")
    .mockReturnValue({ kind: "use", open: () => () => {} });
  vi.spyOn(await import("../navigation/surface-host"), "useSurfaceHost").mockReturnValue({ surface: "web" } as never);
  vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
  const threads = [{ id: "jz-family-first" }, { id: "jz-family-other" }];
  const store = createChatPageStore({ registry: appAtomRegistry, search: { mode: "threads", patch: async () => {} } });
  conversation.value = { store, threads };
  const { builtinRouteStamp } = await import("./builtin-inventory");
  const stamp = workFingerprintSchema.parse(`builtin-closure:${builtinRouteStamp("family")}`);
  const declaration = route({ ...family.spec, panes: { workspace: {
    ...family.spec.panes.workspace,
    draw: ctx => <output aria-label="Mounted Family Work">{ctx.cells.doc?.spec?.doc.fileName}</output>,
  } } });
  function Family() { return <TypedShell module={declaration} fingerprint={stamp} />; }
  const root = createRootRoute({ component: () => <RegistryContext.Provider value={appAtomRegistry}>
    <RouteDock renderRoute={body => body}>{null}</RouteDock>
  </RegistryContext.Provider> });
  const router = createRouter({ routeTree: root.addChildren([
    createRoute({ getParentRoute: () => root, path: "/family", component: Family }),
  ]), history: createMemoryHistory({ initialEntries: ["/family"] }) });
  const read = (thread: string) => withInvocationContext({ caller: { kind: "pea", context: `ctx-${thread}`, thread } },
    () => api.fetch(new Request(`http://host/pe/route-view/family?thread=${thread}`)));
  vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
  try {
    await router.load();
    render(<RouterProvider router={router} />);
    await screen.findByText("retained-spec.pdf");
    const seam = screen.getByRole("separator", { name: "Resize pane" });
    for (let i = 0; i < 40 && !screen.queryByRole("button", { name: "Expand tools" }); i++)
      fireEvent.keyDown(seam, { key: "ArrowRight" });
    expect(screen.getByRole("button", { name: "Expand tools" }), "B05: the actual tools Activity is folded").toBeTruthy();
    await (await import("@testing-library/react")).act(() => store.actions.promoteThread(threads[0]!.id));
    expect(router.state.location.search.thread, "B05: first Send supplies the thread after the drawing folded").toBe(threads[0]!.id);
    await waitFor(async () => expect((await read(threads[0]!.id)).status,
      "B05: folding before promotion must not lose the selected Place").toBe(200));
    const first = await (await read(threads[0]!.id)).json();
    expect(first.context.work, "B05: mounted Work is host-bound, not the conversation document").toEqual(key);
    expect(first.work, "B05: Pea receives authoritative Work including its attached spec").toMatchObject({ revision: 3, doc });
    const now = Date.now();
    vi.spyOn(Date, "now").mockReturnValue(now + 20_000);
    await (await import("@testing-library/react")).act(() => vi.advanceTimersByTimeAsync(5_000));
    expect((await read(threads[0]!.id)).status, "B05: a folded Place refreshes past the 15-second lease expiry").toBe(200);
    await (await import("@testing-library/react")).act(() => router.navigate({ to: "/family", search: { thread: threads[1]!.id } }));
    await waitFor(async () => expect((await read(threads[1]!.id)).status).toBe(200));
    expect((await read(threads[0]!.id)).status, "B05: switching conversation retires the previous association").toBe(409);
    await (await import("@testing-library/react")).act(() => router.navigate({ to: "/family", search: { thread: threads[0]!.id } }));
    await waitFor(async () => expect((await read(threads[0]!.id)).status).toBe(200));
    expect((await (await read(threads[0]!.id)).json()).work).toMatchObject({ revision: 3, doc });
    expect(publicRoutes.declaration("family"), "B05: the shipped root registers typed builtins").toMatchObject({ name: "Family" });
    const context = rememberPlace({ documents: [], works: [] }, "family", "/family");
    const snapshot = await readThreadWork(host.workspace, {
      threads: async () => [], documents: async () => [], contexts: () => [{ threadId: threads[0]!.id, context }],
    });
    expect(chatPluginTitle(snapshot.threads[0]!.place!), "B05: the row names its Place independently of unfinished Work").toBe("Family");
  } finally {
    cleanup();
    vi.useRealTimers();
    vi.restoreAllMocks();
    sessionStorage.clear();
    await host.close();
    vi.unstubAllGlobals();
    conversation.value = null;
  }
}, 30_000);


test.each(["takeoffs", "families"] as const)("JZ kernel Start on %s settles while Reading or after it, and exposes a stale-custody refusal", async (route) => {
  const { gate } = await import("../../../host/tests/host-read-graph.test-support");
  for (const phase of ["settled", "reading"] as const) {
    const catalogue = phase === "reading" ? gate() : undefined;
    const j = await takeoffJourney({ catalogue, start: false, ...(route === "families" ? { route } : {}) });
    function Journey() {
      useSyncExternalStore(j.mount.subscribe, j.mount.revision, j.mount.revision);
      return <KeyScopeHost id={`start-${route}`}><TypedChrome mount={j.mount} document={<span>Project document</span>} /></KeyScopeHost>;
    }
    const root = createRootRoute({ component: Journey });
    const router = createRouter({ routeTree: root, history: createMemoryHistory({ initialEntries: [`/${route}`] }) });
    render(<RouterProvider router={router} />);
    try {
      const start = await screen.findByRole("button", { name: "Start" });
      if (!catalogue) await waitFor(() => expect(j.mount.value().current).toBe(true), { timeout: 20000 });
      else expect(j.mount.value()).toMatchObject({ current: false, status: "pending" });
      // A retained press can race custody loss. At base this rejects before the catch and vanishes.
      await act(async () => { j.mount.release(); fireEvent.click(start); });
      expect(screen.getAllByRole("alert").some(row => row.textContent === "Place is not writable")).toBe(true);
      expect((await j.host.journal.list()).filter(row => row.key === "work.start")).toHaveLength(0);
      await act(async () => { const reacquire = j.mount.subscribe(() => {}); reacquire(); });
      await waitFor(() => expect(screen.getByRole("button", { name: "Start" }).getAttribute("aria-disabled")).toBeNull());
      fireEvent.click(screen.getByRole("button", { name: "Start" }));
      catalogue?.release.resolve();
      await waitFor(() => expect(j.mount.owner()?.ready).toBe(true));
      await j.ready();
      const receipts = (await j.host.journal.list()).filter(row => row.key === "work.start");
      expect(receipts).toHaveLength(1);
      expect(receipts[0]!.state).toBe("succeeded");
      expect(screen.queryByRole("button", { name: "Start" })).toBeNull();
      if (route === "takeoffs") expect(j.mount.value().value.initialize.refusal).toBeNull();
      else {
        const category = await screen.findByRole("button", { name: "Choose Air Terminal Tags" });
        expect(category.getAttribute("aria-disabled")).toBeNull();
        fireEvent.click(category);
        await j.ready();
        await waitFor(() => expect(j.mount.owner()?.doc.scope.edit?.value.categoryNames).toEqual(["Air Terminal Tags"]));
      }
    } finally { await j.close(); }
  }
}, 60000);

test("JZ saved Takeoffs capture explains its empty snapshot and returns to live candidates", async () => {
  const j = await takeoffJourney();
  try {
    await j.ready();
    render(<TakeoffDrawing mount={j.mount} />);
    const capture = adoptionData.parse(j.mount.value().value).captures[0]!;
    fireEvent.click(screen.getByRole("button", { name: "Choose capture" }));
    const option = (await screen.findAllByRole("option")).find(row => row.textContent?.includes(capture.capturedAt));
    fireEvent.click(option!);
    await waitFor(() => expect(j.mount.value().current).toBe(true), { timeout: 20000 });
    expect(screen.getByText(/Archived takeoff/)).toBeTruthy();
    expect(screen.getByText("No adopted zones in this saved takeoff")).toBeTruthy();
    expect(screen.getByText(/This capture stores takeoff data, not a view image/)).toBeTruthy();
    expect(screen.queryByRole("img")).toBeNull();
    expect(screen.queryByRole("button", { name: "initialize" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "live" }));
    await j.ready();
    fireEvent.click(screen.getByRole("button", { name: "Choose views" }));
    fireEvent.click(await screen.findByRole("option", { name: "Zoning plan" }));
    await screen.findByRole("checkbox", { name: "Select Office zone in Zoning plan" });
  } finally { await j.close(); }
}, 60000);
