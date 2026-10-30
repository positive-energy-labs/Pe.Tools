// @vitest-environment jsdom
import { StrictMode } from "react";
import { act, cleanup, fireEvent, render, waitFor, within } from "@testing-library/react";
import { createMemoryHistory, createRouter, RouterProvider } from "@tanstack/react-router";
import { afterEach, beforeEach, expect, test, vi } from "vite-plus/test";
import { z } from "zod";
import {
  actionReceiptSchema,
  draftCellSchema,
  pane,
  split,
  workKey,
  type RouteGraph,
  type WorkKey,
  type WorkWrite,
  type ActionReceipt,
} from "@pe/agent-contracts";
import { field } from "../../../../packages/agent-contracts/src/route-field";
import { listSearchKey, listSearchCodec } from "@pe/agent-contracts";
import { KeyScope, readRegistrations, readKeyMeta } from "@pe/kit/keys";
import { RouteWorkspace } from "../../../../packages/runtime/src/route-workspace";
import { Route as root } from "../routes/__root";
import {
  createGraphMount,
  mountRoute,
  routeFromGraph,
  type MountAdapters,
  type RouteAdapters,
  type GraphMount,
  type MountScope,
} from "./mount";
import { commandVerb, workVerb } from "./verbs";
import type { ReadingContext, ReadingDelivery } from "./readings";
import { peReadings } from "#/readings";

const transport = vi.hoisted(() => ({ run: vi.fn() }));
vi.mock("../../../../packages/mcps/src/shared/takeoff-action-client", () => ({
  runSemanticAction: transport.run,
  cancelRunningAdmissions: vi.fn(async () => []),
}));
// The kernel's Target/Work door, faked with the fixture's ports; null runs the real door.
const door = vi.hoisted(() => ({ ports: null as object | null }));
vi.mock("./use-work-scope", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./use-work-scope")>();
  return {
    useWorkScope: (graph: never, page?: never, binding?: never) =>
      door.ports
        ? {
            ...door.ports,
            status: {
              resolution: { kind: "resolved", target: { kind: "host" } },
              bindingLost: null,
              targetProvenance: { source: "none" },
              closed: false,
            },
          }
        : actual.useWorkScope(graph, page, binding),
  };
});
vi.mock("../routes/__root", async () => {
  const { createRootRoute, Outlet } = await import("@tanstack/react-router");
  return { Route: createRootRoute({ component: Outlet }) };
});

const cleanups: (() => void)[] = [];
const noRead = (): (() => void) => () => {};
let subscribed = vi.fn(noRead);
beforeEach(() => {
  const storage = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key),
    clear: () => storage.clear(),
  });
  localStorage.clear();
  transport.run.mockReset();
  door.ports = null;
  subscribed = vi.fn(noRead);
  vi.spyOn(peReadings, "subscribe").mockImplementation(subscribed);
  transport.run.mockResolvedValue(receipt());
  vi.stubGlobal("scrollTo", vi.fn());
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
});
afterEach(async () => {
  cleanup();
  await new Promise((resolve) => setTimeout(resolve, 5));
  for (const release of cleanups.splice(0).reverse()) release();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
function receipt(): ActionReceipt {
  return actionReceiptSchema.parse({
    id: "native-1",
    key: "takeoffs.initialize",
    caller: { kind: "human", via: "local" },
    target: { kind: "host" },
    basis: null,
    input: { stage: "sheet" },
    steps: [],
    prepared: { state: "unprepared" },
    recovery: [],
    startedAt: "2026-10-29T12:00:00Z",
    state: "succeeded",
    result: { wrote: true },
  });
}
type Page = { stage: string; cfm: number };
type Doc = {
  rows: Record<string, { id: string; n: number }>;
  rules?: Record<
    string,
    { suggestion?: { value: string } | null; edit?: { value: string } | null }
  >;
};
const key: WorkKey = { binding: "workspace", route: "mount-proof", target: null, work: "one" };
const rows = z.record(z.string(), z.object({ id: z.string(), n: z.number() }));
const docSchema = z.object({ rows });
const cellDocSchema = z.object({
  rows,
  rules: z.record(z.string(), draftCellSchema(z.string())).default({}),
});

/** `cells` adds a `rules` segment of cells (and the graph's Work schema + cell declaration) to the Work. */
async function fixture(cells = false) {
  const initial = {
    version: 1,
    revision: 0,
    doc: {
      rows: { slot: { id: "row-a", n: 1 } },
      ...(cells ? { rules: { a: { suggestion: { value: "one" } } } } : {}),
    },
  };
  const stored = new Map<string, unknown>([[workKey(key), initial]]);
  const workspace = new RouteWorkspace({
    registrations: [
      {
        spec: {
          route: key.route,
          title: "Mount proof",
          description: "Mount",
          schema: cells ? cellDocSchema : docSchema,
        },
      },
    ],
    store: {
      getState: async ({ targetKey }) => structuredClone(stored.get(targetKey) ?? null),
      setState: async ({ targetKey, value }) => {
        stored.set(targetKey, structuredClone(value));
      },
    },
  });
  let scope: MountScope<Doc> & { work: NonNullable<MountScope<Doc>["work"]> } = {
    target: { kind: "host" as const },
    work: { handle: { key, revision: 0 }, doc: initial.doc },
  };
  const listeners = new Set<() => void>();
  const writes: WorkWrite[] = [];
  const captures: { ctx: ReadingContext; deliver: ReadingDelivery; released: boolean }[] = [];
  let latest: GraphMount<Page, Doc> | undefined;
  let subscriptions = 0;
  let deltaSubscriptions = 0;
  let documentChange: ((ref: { session: string; openId: string }) => void) | undefined;
  let late: ((receipt: ActionReceipt, key: WorkKey | null, press?: string) => void) | undefined;
  const graph: RouteGraph<Page, Doc> = {
    key: "mount-proof",
    address: "mount-proof",
    name: "Mount proof",
    ...(cells
      ? {
          needs: "document" as const,
          work: cellDocSchema as unknown as z.ZodType<Doc>,
          cells: [{ segment: "rules", groupOf: (id: string) => [id], nouns: ["rule"] }],
        }
      : {}),
    fields: {
      stage: { ...field(z.string().default("edit"), {}), role: "stage" },
      cfm: { ...field(z.number().default(400), {}), role: "query", editor: "situation" },
    },
    readings: {
      result: {
        kind: "derive",
        source: "solve",
        deps: ["page"],
        args: (page) => page,
        retire: "page",
      },
      capture: { kind: "use", source: "capture", retire: "target" },
    },
    verbs: {
      edit: workVerb(
        { label: "Edit", subject: "row", chord: "E", input: z.object({}) },
        {
          patches: (scope) => [
            { path: [...scope.subject!.path, "n"], value: (scope.value as { n: number }).n + 1 },
          ],
        },
      ),
      other: workVerb(
        { label: "Other", subject: "row", chord: "O", input: z.object({}) },
        { patches: () => [{ path: ["rows", "slot", "n"], value: 10 }] },
      ),
      apply: commandVerb(
        "takeoffs.initialize",
        { label: "Apply", chord: "Mod+Enter", input: z.object({}), review: "shown" },
        { prepare: () => ({ summary: "Write this row" }), intent: () => ({ stage: "sheet" }) },
      ),
    },
    panes: {
      wheel: { label: "Wheel", purpose: "Drag airflow", draws: ["result"], verbs: [] },
      inputs: { label: "Inputs", purpose: "Type inputs", draws: ["result", "capture"], verbs: [] },
      charts: { label: "Charts", purpose: "See result", draws: ["result"], verbs: [] },
    },
    layout: split(
      "calc",
      { axis: "v", sized: "end", size: 300 },
      split("top", { axis: "h", sized: "end", size: 300 }, pane("wheel"), pane("inputs")),
      pane("charts"),
    ),
    stages: {
      edit: { word: "Editing", panes: ["wheel", "inputs", "charts"], verbs: ["edit", "apply"] },
      inspect: { word: "Inspecting", panes: ["charts"], verbs: ["other"] },
    },
  };
  const refresh = async (next = scope.work.handle.key) => {
    const envelope = await workspace.read(next, next.route);
    if (!envelope) throw Error("Missing fixture Work");
    scope = {
      ...scope,
      work: { handle: { key: next, revision: envelope.revision }, doc: envelope.doc as Doc },
    };
    for (const notify of listeners) notify();
  };
  const adapters: MountAdapters<Page, Doc> & RouteAdapters<Page, Doc> = {
    getSnapshot: () => scope,
    subscribe: (notify) => {
      subscriptions++;
      listeners.add(notify);
      return () => {
        subscriptions--;
        listeners.delete(notify);
      };
    },
    sources: {
      solve: { kind: "derive", derive: (ctx) => (ctx.page as Page).cfm * 2 },
      capture: {
        kind: "use",
        open: (ctx, deliver) => {
          const entry = { ctx, deliver, released: false };
          captures.push(entry);
          deliver({ kind: "complete", value: "captured", revision: 0 });
          return () => {
            entry.released = true;
          };
        },
      },
    },
    write: async (requested, write) => {
      writes.push(structuredClone(write));
      const result = await workspace.write(requested, requested.route, "human", write);
      if (result.ok) await refresh(requested);
      return result;
    },
    subscribeAcceptedDeltas: (requested, onAck) => {
      deltaSubscriptions++;
      const release = workspace.subscribe((event) => {
        if (event.ok && workKey(event.key) === workKey(requested)) onAck(event);
      });
      return () => {
        deltaSubscriptions--;
        release();
      };
    },
    binding: (id, _row, scope) => ({
      subject:
        id !== "apply" && scope.work
          ? { type: "row", id: "row-a", work: scope.work.handle.key, path: ["rows", "slot"] }
          : null,
      args: {},
    }),
    subjects: { row: (value) => (value as { id: string }).id },
    verbReadings: { apply: ["capture"] },
    receiptPaths: () => [["rows", "slot", "n"]],
    subscribeDocumentChanged: (accept) => {
      documentChange = accept;
      return () => {
        documentChange = undefined;
      };
    },
    subscribeReceipts: (accept) => {
      late = accept;
      return () => {
        late = undefined;
      };
    },
    checkpoint: async () => ({ at: "2026-10-29T13:00:00Z", receiptId: "checkpoint-hash" }),
    bodies: {
      wheel: () => <output aria-label="Wheel">Wheel</output>,
      inputs: ({ owner }) => {
        latest = owner;
        return <input aria-label="Native text" defaultValue="typing" />;
      },
      charts: ({ owner }) => {
        latest = owner;
        return (
          <output aria-label="Solved">{JSON.stringify(owner.readings.get("result").value)}</output>
        );
      },
    },
  };
  return {
    graph,
    adapters,
    captures,
    writes,
    stored,
    workspace,
    refresh,
    scope: () => scope,
    owner: () => {
      if (!latest) throw Error("Owner not mounted");
      return latest;
    },
    subscriptions: () => ({ subscriptions, deltaSubscriptions }),
    documentChange: () => documentChange,
    late: () => late,
  };
}
async function mounted(f: Awaited<ReturnType<typeof fixture>>, strict = false) {
  door.ports = f.adapters;
  const route = routeFromGraph(f.graph, f.adapters, "/mount-proof");
  const router = createRouter({
    routeTree: root.addChildren([route]),
    history: createMemoryHistory({ initialEntries: ["/mount-proof"] }),
  });
  await router.load();
  const view = render(
    strict ? (
      <StrictMode>
        <RouterProvider router={router} />
      </StrictMode>
    ) : (
      <RouterProvider router={router} />
    ),
  );
  await view.findByLabelText("Solved");
  return { view, router };
}
function chord(target: Element | Document, key: string, shift = false) {
  fireEvent.keyDown(target, {
    key,
    code: key === "Enter" ? "Enter" : `Key${key.toUpperCase()}`,
    ctrlKey: true,
    shiftKey: shift,
  });
  fireEvent.keyUp(target, { key, ctrlKey: true, shiftKey: shift });
}

test("admission shows graph and reserved chord refusals and acquires nothing", async () => {
  const f = await fixture();
  f.graph.panes.inputs!.draws = ["missing"];
  f.graph.verbs.edit!.chord = "Mod+Z";
  const get = vi.spyOn(f.adapters, "getSnapshot");
  const Component = mountRoute(f.graph, f.adapters);
  const view = render(<Component />);
  expect(view.getByRole("alert").textContent).toContain("Unknown reading 'missing'");
  expect(view.getByRole("alert").textContent).toContain("reserved");
  expect(get).not.toHaveBeenCalled();
  expect(f.subscriptions()).toEqual({ subscriptions: 0, deltaSubscriptions: 0 });
});

test("missing source bindings and cyclic readings refuse before creating a partial owner", async () => {
  const f = await fixture();
  delete (f.adapters.sources as Record<string, unknown>).solve;
  f.graph.readings.capture!.deps = ["capture"];
  const snapshot = vi.spyOn(f.adapters, "getSnapshot");
  const Component = mountRoute(f.graph, f.adapters);
  const view = render(<Component />);
  expect(view.getByRole("alert").textContent).toContain("Unresolved derive source 'solve'");
  expect(view.getByRole("alert").textContent).toContain("Reading dependency cycle");
  expect(snapshot).not.toHaveBeenCalled();
  expect(f.captures).toEqual([]);
});

test("one graph mounts Page-derived layout and one stable owner; Work press, Mod+Z and redo use host inverses", async () => {
  const f = await fixture();
  const { view } = await mounted(f, true);
  const owner = f.owner();
  const journal = owner.journal(key);
  const readings = owner.readings;
  const timeline = owner.timeline;
  await waitFor(() => expect(view.getByLabelText("Solved").textContent).toBe("800"));
  fireEvent.click(view.getByRole("button", { name: "Edit" }));
  await waitFor(() => expect(f.scope().work.doc.rows.slot!.n).toBe(2));
  expect(journal.read().undo).toHaveLength(1);
  expect(timeline.read().map((e) => e.kind)).toEqual(["invocation"]);
  const control = view.getByRole("button", { name: "Edit" });
  control.focus();
  chord(control, "z");
  await waitFor(() => expect(f.scope().work.doc.rows.slot!.n).toBe(1));
  expect(f.writes.at(-1)).toMatchObject({ kind: "restore", press: null, expectedRevision: 1 });
  chord(control, "z", true);
  await waitFor(() => expect(f.scope().work.doc.rows.slot!.n).toBe(2));
  chord(control, "z");
  await waitFor(() => expect(f.scope().work.doc.rows.slot!.n).toBe(1));
  chord(control, "y");
  await waitFor(() => expect(f.scope().work.doc.rows.slot!.n).toBe(2));
  fireEvent.change(view.getByLabelText("cfm"), { target: { value: "500" } });
  await waitFor(() => expect(view.getByLabelText("Solved").textContent).toBe("1000"));
  expect(f.owner()).toBe(owner);
  expect(owner.journal(key)).toBe(journal);
  expect(owner.readings).toBe(readings);
  expect(owner.timeline).toBe(timeline);
  const text = view.getByLabelText("Native text");
  text.focus();
  chord(text, "z");
  await act(async () => {});
  expect(f.scope().work.doc.rows.slot!.n).toBe(2);
  expect(f.subscriptions()).toEqual({ subscriptions: 1, deltaSubscriptions: 1 });
});

test("Situation renders declared subject, typed Page controls, verbs and a working log filter", async () => {
  const f = await fixture();
  const graph = f.graph as RouteGraph<any, Doc>;
  Object.assign(graph, { subject: () => "Pricing fans on the fixture" });
  Object.assign(graph.fields, {
    mode: { ...field(z.enum(["all", "one"]).default("all"), {}), role: "subject" },
    system: {
      ...field(z.array(z.string()).default([]), {}),
      role: "subject",
      picker: {
        reading: "capture",
        placeholder: "choose a system",
        options: () => [{ id: "SA", label: "Supply air" }],
      },
    },
    search: { ...field(listSearchKey(), {}, listSearchCodec), role: "draft", editor: "situation" },
    paneSearch: { ...field(z.string().default("local"), {}), role: "query" },
    selected: { ...field(z.string().default("4"), {}), role: "selection" },
  });
  const { view } = await mounted(f);
  const situation = within(view.getByLabelText("Situation"));
  expect(situation.getByText("Pricing fans on the fixture")).toBeTruthy();
  expect(situation.queryByLabelText("paneSearch")).toBeNull();
  expect(situation.queryByLabelText("selected")).toBeNull();
  expect(situation.getByRole("button", { name: "Edit" })).toBeTruthy();
  expect(situation.getByRole("button", { name: "Choose mode" })).toBeTruthy();
  fireEvent.click(situation.getByRole("button", { name: "Choose mode" }));
  fireEvent.click(view.getByRole("option", { name: "one" }));
  expect((f.owner().view.read().page as any).mode).toBe("one");
  fireEvent.click(situation.getByRole("button", { name: "Choose system" }));
  fireEvent.click(view.getByRole("option", { name: "Supply air" }));
  expect((f.owner().view.read().page as any).system).toEqual(["SA"]);
  const search = situation.getByLabelText("search");
  expect((search as HTMLInputElement).value).toBe("");
  fireEvent.change(search, { target: { value: "fans" } });
  expect((f.owner().view.read().page as any).search.keywords).toBe("fans");
  act(() =>
    f.owner().view.setPage({
      search: { v: 1, keywords: "fans", pills: [{ field: "kind", op: "=", value: "fan" }] },
    } as any),
  );
  expect(situation.getByText("kind = fan")).toBeTruthy();
  fireEvent.click(situation.getByRole("button", { name: "Remove kind filter" }));
  expect((f.owner().view.read().page as any).search.pills).toEqual([]);
  act(() => {
    f.owner().timeline.append({ kind: "invocation", verb: "edit", at: 1 });
    f.owner().timeline.append({ kind: "feed", subject: "external", at: 2 });
  });
  fireEvent.click(situation.getByRole("button", { name: "work" }));
  expect(situation.getByLabelText("Route log").textContent).toContain("edit");
  expect(situation.getByLabelText("Route log").textContent).not.toContain("external");
});

test("shown review stays at the same control; commit records one receipt and its barrier blocks undo", async () => {
  const f = await fixture();
  const { view } = await mounted(f);
  fireEvent.click(view.getByRole("button", { name: "Edit" }));
  await waitFor(() => expect(f.scope().work.doc.rows.slot!.n).toBe(2));
  const apply = view.getByRole("button", { name: "Apply" });
  fireEvent.click(apply);
  await view.findByLabelText("Apply review");
  expect(view.getByLabelText("Apply review").textContent).toContain("Write this row");
  expect(transport.run).not.toHaveBeenCalled();
  expect(view.getByRole("button", { name: "Apply" })).toBe(apply);
  fireEvent.click(apply);
  await waitFor(() => expect(transport.run).toHaveBeenCalledOnce());
  await waitFor(() => expect(f.owner().reviews.size).toBe(0));
  expect(
    f
      .owner()
      .timeline.read()
      .map((e) => e.kind),
  ).toEqual(["invocation", "invocation", "receipt"]);
  const before = f.writes.length;
  apply.focus();
  chord(apply, "z");
  await act(async () => {});
  expect(f.writes).toHaveLength(before);
  expect(await f.owner().restore("undo")).toMatchObject({ ok: false, code: "barrier" });
  expect(transport.run.mock.calls[0]![5]).toBe(f.owner().timeline.read()[1]!.press);
});

test("pane unmount releases demand while a review pins its acquisition; explicit cancel ends it", async () => {
  const f = await fixture();
  const { view } = await mounted(f);
  fireEvent.click(view.getByRole("button", { name: "Apply" }));
  await view.findByLabelText("Apply review");
  const capture = f.captures.at(-1)!;
  expect(capture.ctx.trigger.kind).toBe("verb");
  act(() => f.owner().view.setPage({ stage: "inspect" }));
  expect(view.queryByLabelText("Native text")).toBeNull();
  expect(capture.released).toBe(false);
  expect(capture.ctx.signal.aborted).toBe(false);
  act(() => f.owner().stop());
  await waitFor(() => expect(capture.released).toBe(true));
  expect(capture.ctx.signal.aborted).toBe(true);
  expect(transport.run).not.toHaveBeenCalled();
});

test("stage changes replace key registration and pane bindings stay inside kit Pane scope", async () => {
  const f = await fixture();
  f.graph.stages.edit!.verbs = ["apply"];
  f.graph.panes.inputs!.verbs = ["edit"];
  const { view } = await mounted(f);
  const scoped = () =>
    readRegistrations().filter(
      (r) => readKeyMeta(r.options.meta)?.actionId === "route.mount-proof.edit",
    );
  await waitFor(() => expect(scoped()).toHaveLength(1));
  expect(readKeyMeta(scoped()[0]!.options.meta)?.scope).toBe("inputs");
  const inputPane = view
    .getByRole("region", { name: "Mount proof route" })
    .querySelector<HTMLElement>("[data-pane-id='inputs']")!;
  inputPane.focus();
  fireEvent.keyDown(inputPane, { key: "e", code: "KeyE" });
  fireEvent.keyUp(inputPane, { key: "e", code: "KeyE" });
  await waitFor(() => expect(f.scope().work.doc.rows.slot!.n).toBe(2));
  act(() => f.owner().view.setPage({ stage: "inspect" }));
  await waitFor(() => expect(scoped()).toHaveLength(0));
  const other = view.getByRole("button", { name: "Other" });
  other.focus();
  fireEvent.keyDown(other, { key: "e", code: "KeyE" });
  fireEvent.keyUp(other, { key: "e", code: "KeyE" });
  expect(f.scope().work.doc.rows.slot!.n).toBe(2);
  fireEvent.keyDown(other, { key: "o", code: "KeyO" });
  fireEvent.keyUp(other, { key: "o", code: "KeyO" });
  await waitFor(() => expect(f.scope().work.doc.rows.slot!.n).toBe(10));
});

test("late command receipt remains associated with dispatch Work after switching to another Work", async () => {
  const f = await fixture();
  const owner = createGraphMount(f.graph, f.adapters);
  const disconnect = owner.connect();
  cleanups.push(() => {
    disconnect();
    owner.dispose();
  });
  await owner.control("edit").run();
  const review = await owner.control("apply").run();
  expect(review.state).toBe("review");
  let resolve!: (receipt: ActionReceipt) => void;
  transport.run.mockImplementation(
    () =>
      new Promise<ActionReceipt>((done) => {
        resolve = done;
      }),
  );
  const pending = owner.control("apply").run();
  await waitFor(() => expect(resolve).toBeDefined());
  const second = { ...key, work: "two" };
  f.stored.set(workKey(second), {
    version: 1,
    revision: 0,
    doc: { rows: { slot: { id: "row-a", n: 1 } } },
  });
  await f.refresh(second);
  await owner.control("edit").run();
  // Busy admission refuses the new edit while the original command is running.
  expect(owner.journal(second).read().undo).toHaveLength(0);
  resolve(receipt());
  await pending;
  expect(owner.timeline.read().at(-1)?.basis).toMatchObject({ workKey: workKey(key) });
  expect(await owner.journal(key).undo((write) => f.adapters.write(key, write))).toMatchObject({
    code: "barrier",
  });
  await owner.control("edit").run();
  expect(await owner.restore("undo")).toMatchObject({ ok: true });
});

test("accepted foreign deltas, settled late receipts and checkpoint facts enter their owners; disposal unsubscribes", async () => {
  const f = await fixture();
  const owner = createGraphMount(f.graph, f.adapters);
  const disconnect = owner.connect();
  cleanups.push(() => owner.dispose());
  await owner.control("edit").run();
  await f.workspace.write(key, key.route, "pea", {
    kind: "apply",
    press: "pea",
    expectedRevision: 1,
    patches: [{ path: ["rows", "slot", "n"], value: 4 }],
  });
  expect(await owner.restore("undo")).toMatchObject({ code: "barrier" });
  f.late()!(receipt(), key, "original-press");
  await owner.checkpoint();
  expect(owner.timeline.read().map((e) => e.kind)).toEqual(["invocation", "receipt", "checkpoint"]);
  disconnect();
  owner.dispose();
  expect(f.subscriptions()).toEqual({ subscriptions: 0, deltaSubscriptions: 0 });
  expect(f.late()).toBeUndefined();
  expect(f.documentChange()).toBeUndefined();
});

test("required answers stay in the same review until valid, and a different placement cannot commit it", async () => {
  const f = await fixture();
  f.graph.verbs = {
    ...f.graph.verbs,
    apply: commandVerb(
      "takeoffs.initialize",
      {
        label: "Apply",
        input: z.object({}),
        review: "required",
        answers: z.object({ approved: z.literal(true) }),
      },
      { prepare: () => ({ summary: "Review first" }), intent: () => ({ stage: "sheet" }) },
    ),
  };
  const { view } = await mounted(f);
  const button = view.getByRole("button", { name: "Apply" });
  fireEvent.click(button);
  await view.findByLabelText("Apply review");
  expect(f.owner().control("apply", undefined, "pane:charts").refusal).toContain(
    "original control",
  );
  fireEvent.click(button);
  await view.findByText("Answer the required review before committing");
  expect(f.owner().reviews.size).toBe(1);
  expect(transport.run).not.toHaveBeenCalled();
  fireEvent.change(view.getByLabelText("Apply answers"), {
    target: { value: '{"approved":true}' },
  });
  fireEvent.click(button);
  await waitFor(() => expect(f.owner().reviews.size).toBe(0));
  expect(transport.run).toHaveBeenCalledOnce();
  expect(
    f
      .owner()
      .timeline.read()
      .filter((e) => e.kind === "invocation"),
  ).toHaveLength(1);
});

test("a dynamic pane binds only its explicit focused row and keeps row identity on the verb", async () => {
  const f = await fixture();
  const row = { id: "row-a", path: ["rows", "slot"] };
  f.graph.panes.inputs!.verbs = Object.assign(
    (row: unknown) => ((row as { id: string }).id === "row-a" ? ["edit"] : []),
    { ids: ["edit"] },
  );
  f.graph.stages.edit!.verbs = ["apply"];
  f.adapters.binding = (id, row, scope) => ({
    subject:
      id === "edit" && row && scope.work
        ? {
            type: "row",
            id: (row as typeof row & { id: string }).id,
            path: ["rows", "slot"],
            work: scope.work.handle.key,
          }
        : null,
    args: {},
  });
  f.adapters.bodies = {
    ...f.adapters.bodies,
    inputs: ({ owner, verbs, focusRow }) => (
      <div>
        <button onClick={() => focusRow(row)}>Focus row</button>
        {verbs(row)}
        <output>{owner.readings.get("capture").status}</output>
      </div>
    ),
  };
  const { view } = await mounted(f);
  const editKeys = () =>
    readRegistrations().filter(
      (r) => readKeyMeta(r.options.meta)?.actionId === "route.mount-proof.edit",
    );
  expect(editKeys()).toHaveLength(0);
  fireEvent.click(view.getByRole("button", { name: "Focus row" }));
  await waitFor(() => expect(editKeys()).toHaveLength(1));
  const pane = view.container.querySelector<HTMLElement>("[data-pane-id='inputs']")!;
  pane.focus();
  fireEvent.keyDown(pane, { key: "e", code: "KeyE" });
  fireEvent.keyUp(pane, { key: "e", code: "KeyE" });
  await waitFor(() => expect(f.scope().work.doc.rows.slot!.n).toBe(2));
  expect(f.owner().journal(key).read().undo).toHaveLength(1);
});

test("parent hidden scope prevents keys, writes and pane demand; retained controls recheck ownership", async () => {
  const f = await fixture();
  door.ports = f.adapters;
  const route = routeFromGraph(f.graph, f.adapters, "/mount-proof");
  const router = createRouter({
    routeTree: root.addChildren([route]),
    history: createMemoryHistory({ initialEntries: ["/mount-proof"] }),
  });
  await router.load();
  const view = render(
    <KeyScope id="hosted" hidden>
      <RouterProvider router={router} />
    </KeyScope>,
  );
  await view.findByLabelText("Solved");
  expect(f.captures).toHaveLength(0);
  fireEvent.click(view.getByRole("button", { name: "Edit" }));
  expect((await f.owner().control("edit").run()).state).toBe("refused");
  expect(f.writes).toHaveLength(0);
  view.rerender(
    <KeyScope id="hosted">
      <RouterProvider router={router} />
    </KeyScope>,
  );
  await waitFor(() => expect(f.captures).toHaveLength(1));
  const retained = f.owner().control("edit");
  view.rerender(
    <KeyScope id="hosted" hidden>
      <RouterProvider router={router} />
    </KeyScope>,
  );
  expect((await retained.run()).state).toBe("refused");
  expect(f.writes).toHaveLength(0);
});

test("disposing an open review cancels its admission and reading pin without dispatch or resurrected subscriptions", async () => {
  const f = await fixture();
  const owner = createGraphMount(f.graph, f.adapters);
  owner.connect();
  await owner.control("apply").run();
  const capture = f.captures.at(-1)!;
  owner.dispose();
  await act(async () => {});
  expect(capture.released).toBe(true);
  expect(capture.ctx.signal.aborted).toBe(true);
  expect(owner.reviews.size).toBe(0);
  expect(f.subscriptions()).toEqual({ subscriptions: 0, deltaSubscriptions: 0 });
  expect(transport.run).not.toHaveBeenCalled();
});

test("settled partial and late command receipts invalidate their aliases; document changes retain exact incarnation", async () => {
  const f = await fixture();
  f.adapters.sources = {
    ...f.adapters.sources,
    capture: {
      kind: "use",
      dirties: ["snapshot"],
      effects: () => [{ kind: "document", ref: { session: "s", openId: "a" } }],
      open: (_ctx, emit) => emit({ kind: "complete", value: "read", revision: 0 }),
    },
  };
  const owner = createGraphMount(f.graph, f.adapters);
  owner.connect();
  cleanups.push(() => owner.dispose());
  const release = owner.readings.mount(["capture"]);
  cleanups.push(release);
  expect(owner.readings.get("capture").current).toBe(true);
  f.documentChange()!({ session: "s", openId: "b" });
  expect(owner.readings.get("capture").current).toBe(true);
  f.documentChange()!({ session: "s", openId: "a" });
  expect(owner.readings.get("capture").status).toBe("stale");
  owner.readings.start("capture", "refresh");
  const partial = actionReceiptSchema.parse({
    ...receipt(),
    id: "partial",
    state: "incomplete",
    error: "Partly applied",
    status: 500,
    effects: [{ kind: "document", ref: { session: "s", openId: "a" } }],
  });
  f.late()!(partial, key, "earlier-press");
  expect(owner.readings.get("capture").status).toBe("stale");
  expect(owner.timeline.read()[0]?.basis).toMatchObject({
    workKey: workKey(key),
    receipt: { state: "incomplete" },
  });
});

test("a detached command's later receipt uses its frozen Work even when the adapter currently shows another Work", async () => {
  const f = await fixture();
  const owner = createGraphMount(f.graph, f.adapters);
  owner.connect();
  cleanups.push(() => owner.dispose());
  await owner.control("edit").run();
  await owner.control("apply").run();
  transport.run.mockResolvedValue({
    state: "detached",
    id: "native-1",
    key: "takeoffs.initialize",
    acceptance: "admitted",
  });
  expect((await owner.control("apply").run()).state).toBe("failed");
  const second: WorkKey = { ...key, work: "two" };
  f.stored.set(workKey(second), {
    version: 1,
    revision: 0,
    doc: { rows: { slot: { id: "row-a", n: 1 } } },
  });
  await f.refresh(second);
  await owner.control("edit").run();
  f.late()!(receipt(), second);
  expect(owner.timeline.read().at(-1)?.basis).toMatchObject({ workKey: workKey(key) });
  expect(await owner.restore("undo")).toMatchObject({ ok: true });
  expect(await owner.journal(key).undo((request) => f.adapters.write(key, request))).toMatchObject({
    code: "barrier",
  });
});

test("graph field policies project Page to URL and Back restores its stage without replaying Work", async () => {
  const f = await fixture();
  const { view, router } = await mounted(f);
  // Fields at rest are absent from the URL: a shared link carries only what the user changed.
  expect(router.state.location.search).not.toHaveProperty("stage");
  expect(router.state.location.search).not.toHaveProperty("cfm");
  expect(f.owner().stage()).toBe("edit");
  const historyLength = router.history.length;
  fireEvent.change(view.getByLabelText("cfm"), { target: { value: "600" } });
  await waitFor(() => expect(router.state.location.search.cfm).toBe(600));
  expect(router.history.length).toBe(historyLength);
  act(() => f.owner().view.setPage({ stage: "inspect" }));
  await waitFor(() => expect(router.state.location.search.stage).toBe("inspect"));
  expect(router.history.length).toBe(historyLength + 1);
  act(() => router.history.back());
  await waitFor(() => expect(f.owner().stage()).toBe("edit"));
  expect(f.writes).toHaveLength(0);
  expect(transport.run).not.toHaveBeenCalled();
});

function cellRows(f: Awaited<ReturnType<typeof fixture>>) {
  f.adapters.cell = (row, scope) => ({
    type: "cell:rules",
    id: (row as { id: string }).id,
    path: ["rules", (row as { id: string }).id],
    work: scope.work!.handle.key,
  });
  f.adapters.bodies = {
    ...f.adapters.bodies,
    inputs: ({ verbs }) => (
      <ul>
        {Object.keys(f.scope().work.doc.rules ?? {}).map((id) => (
          <li key={id} aria-label={`rule ${id}`}>
            {verbs({ id })}
          </li>
        ))}
      </ul>
    ),
  };
}

test("a graph with a Work schema and one cells segment mounts, and its row shows the four cell verbs", async () => {
  const f = await fixture(true);
  cellRows(f);
  const { view } = await mounted(f);
  const row = within(view.getByLabelText("rule a"));
  for (const name of ["take", "reject", "reopen", "delete"])
    expect(row.getByRole("button", { name })).toBeTruthy();
  // Chord-free: nothing is registered for them.
  expect(
    readRegistrations().filter((r) =>
      /\.(take|reject|reopen|delete)$/.test(readKeyMeta(r.options.meta)?.actionId ?? ""),
    ),
  ).toHaveLength(0);
});

test("pressing take on a cell row is one journal step and Mod+Z restores it", async () => {
  const f = await fixture(true);
  cellRows(f);
  const { view } = await mounted(f);
  const take = within(view.getByLabelText("rule a")).getByRole("button", { name: "take" });
  fireEvent.click(take);
  await waitFor(() => expect(f.scope().work.doc.rules!.a!.edit).toMatchObject({ value: "one" }));
  expect(f.owner().journal(key).read().undo).toHaveLength(1);
  take.focus();
  chord(take, "z");
  await waitFor(() => expect(f.scope().work.doc.rules!.a!.edit ?? null).toBeNull());
  expect(f.writes.at(-1)).toMatchObject({ kind: "restore" });
});

test("a graph verb colliding with a cell verb id is refused at admission, not at render", async () => {
  const f = await fixture(true);
  cellRows(f);
  (f.graph.verbs as Record<string, unknown>)["cell:rules.take"] = f.graph.verbs.other;
  const get = vi.spyOn(f.adapters, "getSnapshot");
  const Component = mountRoute(f.graph, f.adapters);
  const view = render(<Component />);
  expect(view.getByRole("alert").textContent).toContain("cell:rules.take");
  expect(get).not.toHaveBeenCalled();
  expect(f.subscriptions()).toEqual({ subscriptions: 0, deltaSubscriptions: 0 });
});

test("a route mounted with no adapter ports gets the kernel's host Target and no Work, reading no document", async () => {
  const f = await fixture();
  const { sources, bodies } = f.adapters;
  const route = routeFromGraph(f.graph, { sources, bodies }, "/mount-proof");
  const router = createRouter({
    routeTree: root.addChildren([route]),
    history: createMemoryHistory({ initialEntries: ["/mount-proof"] }),
  });
  await router.load();
  const view = render(<RouterProvider router={router} />);
  await waitFor(() => expect(view.getByLabelText("Solved").textContent).toBe("800"));
  expect(f.owner().snapshot()).toEqual({ target: { kind: "host" }, work: null });
  expect(subscribed).not.toHaveBeenCalled();
  expect(await f.owner().context.write(key, { patches: [], press: "p" } as never)).toMatchObject({
    ok: false,
    error: "This route has no Work",
  });
});

test("hosted Page is local, carries its thread to bodies, and never rewrites the chat URL", async () => {
  const f = await fixture();
  door.ports = f.adapters;
  const seen: { thread?: string; visible?: boolean } = {};
  const inputs = f.adapters.bodies.inputs!;
  f.adapters.bodies = {
    ...f.adapters.bodies,
    inputs: (body) => {
      Object.assign(seen, { thread: body.thread, visible: body.visible });
      return inputs(body);
    },
  };
  const Hosted = mountRoute(f.graph, f.adapters);
  const route = routeFromGraph(f.graph, f.adapters, "/mount-proof");
  route.update({ component: () => <Hosted thread="conversation-one" url={false} /> });
  const router = createRouter({
    routeTree: root.addChildren([route]),
    history: createMemoryHistory({ initialEntries: ["/mount-proof?cfm=999&thread=outside"] }),
  });
  await router.load();
  const view = render(<RouterProvider router={router} />);
  await view.findByLabelText("Solved");
  expect(f.owner().view.read().page.cfm).toBe(400);
  expect(seen).toEqual({ thread: "conversation-one", visible: true });
  const href = router.history.location.href;
  act(() => {
    f.owner().view.setPage({ cfm: 501 });
  });
  await waitFor(() => expect(view.getByLabelText("Solved").textContent).toBe("1002"));
  expect(router.history.location.href).toBe(href);
});

test("kernel pane furniture has one frame and folded visibility survives a new mount", async () => {
  const f = await fixture();
  f.adapters.furniture = {
    inputs: () => ({ meta: "Fixture meta", actions: <button>Instrument action</button> }),
  };
  const inputs = f.adapters.bodies.inputs!;
  const visible: boolean[] = [];
  f.adapters.bodies = {
    ...f.adapters.bodies,
    inputs: (body) => {
      visible.push(body.visible);
      return inputs(body);
    },
  };
  localStorage.setItem(
    "pe.route.mount-proof.layout",
    JSON.stringify({ inputs: { folded: true, sizes: { '["top","inputs"]': 245 } } }),
  );
  const first = await mounted(f);
  expect(visible.at(-1)).toBe(false);
  expect(first.view.getByRole("button", { name: "Expand Inputs" })).toBeTruthy();
  fireEvent.click(first.view.getByRole("button", { name: "Expand Inputs" }));
  await waitFor(() => expect(visible.at(-1)).toBe(true));
  expect(first.view.container.querySelectorAll('[data-pane-id="inputs"]')).toHaveLength(1);
  expect(first.view.getByText("Fixture meta")).toBeTruthy();
  expect(first.view.getByRole("button", { name: "Instrument action" })).toBeTruthy();
  expect(JSON.parse(localStorage.getItem("pe.route.mount-proof.layout")!).inputs.folded).toBe(
    false,
  );
  first.view.unmount();
  const second = await mounted(await fixture());
  expect(second.view.queryByRole("button", { name: "Expand Inputs" })).toBeNull();
});

test("a declared History pane renders kernel invocations and checkpoints without a route body", async () => {
  const f = await fixture();
  f.graph.panes.wheel!.history = {};
  const { wheel: _wheel, ...bodies } = f.adapters.bodies;
  f.adapters.bodies = bodies;
  const { view } = await mounted(f);
  const history = within(view.getByLabelText("History"));
  expect(history.getByText("No activity yet")).toBeTruthy();
  fireEvent.click(view.getByRole("button", { name: "Edit" }));
  await waitFor(() => expect(history.getByText(/edit.*invocation/)).toBeTruthy());
  act(() => {
    f.owner().timeline.append({ kind: "checkpoint", at: 12, receiptId: "checkpoint-one" });
  });
  expect(history.getByText(/checkpoint.*12/)).toBeTruthy();
});

test("hook-derived furniture uses the kernel frame callback and retains pane hotkeys", async () => {
  const f = await fixture();
  const inputs = f.adapters.bodies.inputs!;
  const { inputs: _inputs, ...bodies } = f.adapters.bodies;
  f.adapters.bodies = bodies;
  f.adapters.frames = { inputs: (body, pane) => pane(inputs(body), { meta: "Dynamic furniture" }) };
  const { view } = await mounted(f);
  expect(view.container.querySelectorAll('[data-pane-id="inputs"]')).toHaveLength(1);
  expect(view.getByText("Dynamic furniture")).toBeTruthy();
  expect(view.getByLabelText("Solved")).toBeTruthy();
});

test("a standalone graph passes its addressed thread to its pane body", async () => {
  const f = await fixture();
  door.ports = f.adapters;
  const inputs = f.adapters.bodies.inputs!;
  let thread: string | undefined;
  f.adapters.bodies = {
    ...f.adapters.bodies,
    inputs: (body) => {
      thread = body.thread;
      return inputs(body);
    },
  };
  const route = routeFromGraph(f.graph, f.adapters, "/mount-proof");
  const router = createRouter({
    routeTree: root.addChildren([route]),
    history: createMemoryHistory({ initialEntries: ["/mount-proof?thread=addressed-thread"] }),
  });
  await router.load();
  const view = render(<RouterProvider router={router} />);
  await view.findByLabelText("Solved");
  expect(thread).toBe("addressed-thread");
});

test("shared History scopes receipts to exact Work, links Ops, deduplicates events and says read failures", async () => {
  const f = await fixture();
  const receiptFor = (id: string, work: WorkKey) =>
    actionReceiptSchema.parse({
      ...receipt(),
      id,
      consumes: [
        {
          kind: "work",
          probe: { handle: { key: work, revision: 0 }, paths: [["rows"]] },
          expected: {},
        },
      ],
    });
  let deliver!: ReadingDelivery;
  f.graph.readings = {
    ...f.graph.readings,
    history: { kind: "use", source: "history", retire: "target" },
  };
  f.graph.panes.wheel!.history = { receipts: "history" };
  f.graph.panes.wheel!.draws = [];
  f.adapters.sources = {
    ...f.adapters.sources,
    history: {
      kind: "use",
      open: (_context, send) => {
        deliver = send;
        send({
          kind: "complete",
          revision: 1,
          value: [
            receiptFor("ours", key),
            receiptFor("other", { binding: "host", route: "other", target: null }),
          ],
        });
      },
    },
  };
  const mountedView = await mounted(f);
  const view = within(mountedView.view.container.querySelector("[data-pane-id=wheel]")!);
  const link = await view.findByRole("link", { name: "takeoffs.initialize" });
  expect(link.getAttribute("href")).toContain("actionId=ours");
  expect(view.queryAllByRole("link", { name: "takeoffs.initialize" })).toHaveLength(1);
  act(() => f.owner().timeline.append({ kind: "checkpoint", at: 77, receiptId: "ours" }));
  expect(view.queryByText(/checkpoint.*77/)).toBeNull();
  act(() => deliver({ kind: "failure", error: "receipt service unavailable" }));
  expect(await view.findByText("receipt service unavailable")).toBeTruthy();
});

test("a History pane naming an absent reading is refused before mounting", async () => {
  const f = await fixture();
  f.graph.panes.wheel!.history = { receipts: "missing" };
  const Route = mountRoute(f.graph, f.adapters);
  const view = render(<Route />);
  expect(view.getByRole("alert").textContent).toContain("panes.wheel.history.receipts");
  expect(f.subscriptions()).toEqual({ subscriptions: 0, deltaSubscriptions: 0 });
});
