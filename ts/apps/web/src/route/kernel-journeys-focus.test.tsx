// @vitest-environment jsdom
import { useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vite-plus/test";
import { createMemoryHistory, createRootRoute, createRouter, RouterProvider } from "@tanstack/react-router";
import { route } from "./typed-route";
import { module as fans } from "../fans/route";
import { TypedChrome, TypedShell } from "../shell/typed-shell";
import * as mounts from "../shell/typed-mount";
import { workFingerprintSchema, type WorkJournalDoor } from "@pe/agent-contracts";
import { ReviewSurface } from "../shell/review-surface";
import { RouteVisibility } from "./activity";
import { setup as scheduleHost } from "../../../host/tests/schedule-test-fixture";
import { module as schedules } from "../schedules/route";
import { namesOf } from "./typed-route";
import { createWorkFeedClient } from "../shell/work-feed-client";
import type { UseSource } from "../shell/source-contract";
import { KeyScopeHost } from "@pe/kit/keys";
import { familyDraftRouteState } from "@pe/agent-contracts";
import { module as family } from "../family/route";
import { createFixtureWorkDoor } from "../shell/fixture-work-door";
import { evaluate } from "../../../host/src/reads/evaluator";
import { reads as familyReads } from "../../../host/src/reads/family";
import { FAMILY_MODEL_SCHEMA } from "../family/page";
import { leaks } from "../shell/visible-text";

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

test("D G07 Family renders named picker, member roster, Work and stage words without internal identities", async () => {
  const pod = "f88cf37a-6fda-4ee6-9f20-5b39b47d29ba", member = "Box.family.json";
  const reading = JSON.stringify({ family: { name: "Box" },
    parameters: { Width: { dataType: "Length", value: "24in" }, Height: { dataType: "Length", value: "12in" } },
    types: { Standard: {}, Wide: { Width: "36in" } },
    connectors: { c1: { domain: "Duct", shape: "Round", diameter: "6in", on: "Front" } },
  });
  const original = familyDraftRouteState.schema.parse({ reading, cells: { "/types/Wide/Width": { edit: { value: "40in" } } } });
  const door = createFixtureWorkDoor(familyDraftRouteState, original);
  const ready = Promise.withResolvers<void>();
  let accepted: { key: any; revision: number; doc: unknown };
  const work: WorkJournalDoor = { ...door, open: scope => ({ subscribe(deliver, end) {
    return door.open(scope).subscribe(state => {
      if (state.kind === "ready") {
        accepted = { key: state.snapshot.handle.key, revision: state.snapshot.revision, doc: state.snapshot.value };
        ready.resolve();
      }
      deliver(state);
    }, end);
  } }) };
  const pending = new Set<Promise<unknown>>(), roster = Promise.withResolvers<void>();
  let memberReads = 0;
  const source: UseSource = { kind: "use", open(ctx, deliver) {
    const task = (async () => {
      await ready.promise; await roster.promise;
      const value = await evaluate(familyReads.workspace, { ...(ctx.args as { member: { pod: string; path: string } | null }), target: ctx.target }, {
        evaluation: crypto.randomUUID(), origin: { kind: "d-rendered-family" }, revision: () => accepted.revision,
        async take(name) {
          if (name === "work-scope") return accepted.key;
          if (name === "work") return { doc: accepted.doc, revision: accepted.revision };
          if (name === "local:pod.member.read") { memberReads++; return { content: reading, sha256: "a".repeat(64), bytesBase64: "" }; }
          if (name === "local:pod.member.compose") return { sha256: "a".repeat(64), schemaUrl: FAMILY_MODEL_SCHEMA,
            schemaJson: null, composed: reading, source: { id: pod, path: member, sha256: "a".repeat(64), bytesBase64: "", origin: "SavedMember" },
            diagnostics: [], dependencies: [], schemaValidation: "no-schema", semanticValidation: "not-run" };
          if (name === "file:family-spec") return { doc: null, error: null };
          if (name === "local:pod.list") return { pods: [{ id: pod, name: "Mechanical library", version: "1.0.0",
            folder: "mechanical", entrypoints: [], contributions: [], diagnostics: [], members: [
            { path: member, sha256: "a".repeat(64), schema: FAMILY_MODEL_SCHEMA },
          ] }], unreadable: [] };
          throw Error(`Unexpected Family input: ${name}`);
        },
      });
      if (!ctx.signal.aborted) deliver({ kind: "complete", revision: accepted.revision + 1,
        value: { key: "family.workspace", generation: 0, version: accepted.revision + 1, state: "current", value } });
    })().catch(error => deliver({ kind: "failure", error }));
    pending.add(task); void task.finally(() => pending.delete(task));
    return () => {};
  } };
  let search = new URLSearchParams({ pod });
  const mount = mounts.mountTypedRoute(family, {
    address: { read: () => new URLSearchParams(search), write: next => { search = new URLSearchParams(next); }, subscribe: () => () => {} },
    target: { kind: "host" }, fixture: null, custody: { current: () => true }, memory: () => ({}),
    work: { address: null, open: null },
  }, workFingerprintSchema.parse(`builtin-closure:${"a".repeat(64)}`), { work, sources: { "family.workspace": source } });
  function Journey() { return <TypedChrome mount={mount} document={<span>Family library</span>} />; }
  const root = createRootRoute({ component: Journey });
  const router = createRouter({ routeTree: root, history: createMemoryHistory({ initialEntries: ["/family"] }) });
  const view = render(<RouterProvider router={router} />);
  const cleanWords = (where: string) => {
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT), text: string[] = [];
    while (walker.nextNode()) text.push(walker.currentNode.textContent ?? "");
    const words = [...text, ...Array.from(document.body.querySelectorAll("[aria-label], [title]"))
      .flatMap(node => [node.getAttribute("aria-label") ?? "", node.getAttribute("title") ?? ""]),
      ...Array.from(document.body.querySelectorAll("input")).map(input => input.value)];
    expect.soft(words.flatMap(word => leaks(word)), where).toEqual([]);
    expect.soft(words.join(" "), where).not.toContain(pod);
  };
  try {
    await ready.promise;
    expect(mount.value().current).toBe(false);
    cleanWords("C746: before the roster publication, no raw identity fallback");
    roster.resolve();
    await waitFor(() => expect(mount.value().current, JSON.stringify(mount.value())).toBe(true));
    expect(mount.owner()?.doc).toEqual(original);
    expect.soft(await screen.findByText(member)).toBeTruthy();
    expect.soft(screen.queryByText("Mechanical library")).toBeTruthy();
    cleanWords("C747: actual Work and member payload display strings");
    fireEvent.click(screen.getByText(member));
    await waitFor(() => expect(memberReads).toBeGreaterThan(0));
    await waitFor(() => expect(mount.value().current).toBe(true));
    expect(mount.page.read()).toMatchObject({ pod, path: member });
    expect.soft((screen.getByRole("textbox", { name: "Destination pod" }) as HTMLInputElement).value).toBe("Mechanical library");
    cleanWords("C746: selected roster member keeps its canonical key off the surface");
    await act(async () => fireEvent.click(screen.getAllByRole("button", { name: /^bind/ })[0]!));
    const picker = await screen.findByRole("listbox", { name: "bind c1.diameter" });
    expect(within(picker).getAllByRole("option").some(option => option.textContent?.includes("Width"))).toBe(true);
    cleanWords("C746: rendered binding picker labels");
    fireEvent.keyDown(picker, { key: "Escape", code: "Escape" });
    for (const stage of ["audit", "apply", "history"] as const) {
      await act(async () => mount.page.pose({ stage }));
      expect(mount.page.read().stage).toBe(stage);
      expect(view.container.textContent).toContain("Family");
      cleanWords(`C746: rendered Family route/stage words in ${stage}`);
    }
    fireEvent.change(screen.getByRole("textbox", { name: "Destination pod" }), { target: { value: "new-mechanical" } });
    expect(mount.page.read()).toMatchObject({ pod: "new-mechanical", path: "" });
    expect((screen.getByRole("textbox", { name: "Destination pod" }) as HTMLInputElement).value).toBe("new-mechanical");
    expect(mount.owner()?.doc).toEqual(original);
  } finally { roster.resolve(); view.unmount(); mount.dispose(); await Promise.all(pending); }
}, 30_000);

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

test("JZ B03 people choose named subjects: cold Schedules picker, refused Read, then published Read", async () => {
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
