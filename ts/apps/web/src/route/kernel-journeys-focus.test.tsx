// @vitest-environment jsdom
import { useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
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

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

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

test("JZ B03 people choose named subjects: pending Families scope, cold Schedules picker and honest Read", async () => {
  await pendingFamiliesChoice();
  const host = await scheduleHost();
  host.addSchedule(43, "ElectricDuctHeater");
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
      const task = host.view().then(state => {
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
    await act(async () => { fireEvent.click(screen.getAllByRole("button", { name: "Read schedule" })[1]!); });
    expect(screen.getAllByText("Choose a schedule before reading").length, "B03: refused Read is visible").toBeGreaterThan(0);
    expect.soft(screen.queryAllByText(/.+ complete$/i), "B03: a refused verb must never produce any completion receipt").toEqual([]);
    const chooser = screen.queryByRole("button", { name: "Choose schedule" });
    expect.soft(chooser, "B03: cold open exposes the declared named-subject picker").not.toBeNull();
    if (!chooser) return; // Both base defects above remain assertion failures, not a missing-control exception.
    fireEvent.click(chooser);
    expect(await screen.findByRole("option", { name: "ElectricDuctHeater" }), "B03: choices come from the host catalogue").toBeTruthy();
    fireEvent.click(screen.getByRole("option", { name: "Panel" }));
    await waitFor(() => expect(mount.work()?.handle.key).toEqual(host.scope));
    expect(namesOf(mount.page.read().workspaceId), "B03: chosen name reaches its canonical member").toEqual([host.scope.work]);
    await waitFor(() => expect(mount.value().current).toBe(true));
    const before = host.reads();
    await act(async () => { fireEvent.click(screen.getAllByRole("button", { name: "Read schedule" })[1]!); });
    await waitFor(() => expect(host.reads(), "B03: Read reaches native schedule detail").toBeGreaterThan(before));
    await waitFor(() => expect(mount.result("read")).toBeDefined());
    await waitFor(() => {
      expect(mount.value().current, "B03: Read publishes a current Value").toBe(true);
      expect(mount.value().value?.reading, "B03: publication contains the completed Read, not the old capture").toEqual(mount.result("read"));
    });
    expect(mount.action("read").failure).toBeNull();
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
