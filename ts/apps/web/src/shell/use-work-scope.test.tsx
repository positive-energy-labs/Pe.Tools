// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, waitFor, within } from "@testing-library/react";
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import { afterEach, beforeEach, expect, test, vi } from "vite-plus/test";
import { z } from "zod";
import {
  address,
  pane,
  readingKey,
  START_FRESH_VERB,
  UNREADABLE_WORK,
  workKey,
  type ReadingRequest,
  type RouteGraph,
  type WorkKey,
  type WorkWriteAck,
} from "@pe/agent-contracts";
import { machineFixture } from "../../../../packages/agent-contracts/tests/machine-fixture.ts";
import { field } from "../../../../packages/agent-contracts/src/route-field";
import { peReadings } from "#/readings";
import { Route as appRoot } from "../routes/__root";
import { routeSearch } from "../route/route-owner";
import { createGraphMount, type GraphMount } from "./mount-owner";
import { routeFromGraph } from "./mount";
import { queryVerb, workVerb } from "./verbs";
import { useWorkScope, type WorkScopePorts } from "./use-work-scope";

const host = vi.hoisted(() => ({ write: vi.fn(), fresh: vi.fn(), read: vi.fn() }));
vi.mock("../../../../packages/mcps/src/shared/schedule-client", () => ({
  readScheduleCapture: host.read,
}));
vi.mock("../routes/__root", async () => {
  const { createRootRoute, Outlet } = await import("@tanstack/react-router");
  return { Route: createRootRoute({ component: Outlet }) };
});
vi.mock("../route/host", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../route/host")>()),
  writeRouteWork: host.write,
  startFreshRouteWork: host.fresh,
}));

const DOC = address("C:/Jobs/Level 1.rvt");
const workSchema = z.object({ note: z.string().default("") });
const graph = (
  needs?: RouteGraph["needs"],
): RouteGraph<Record<string, never>, { note: string }> => ({
  key: "scope-proof",
  address: "scope-proof",
  name: "Scope proof",
  fields: {},
  readings: {},
  verbs: {},
  panes: { only: { label: "Only", purpose: "Proof", draws: [], verbs: [] } },
  layout: pane("only"),
  stages: { one: { word: "One", panes: ["only"], verbs: [] } },
  ...(needs ? { needs, work: workSchema } : {}),
});
type Doc = { openId: string; title: string; address: string | null };
// The host's own unreadable-Work failure, answered instead of a snapshot for Work reads.
let unreadable = false;
let world: { sessions: Record<string, Doc[]>; machine: Record<string, Doc[]> };
// Readings outlive one test in the shared registry: every subscriber is handed the current world.
const accepts = new Map<string, { request: ReadingRequest; live: Set<(frame: never) => void> }>();
const frame = (request: ReadingRequest) => {
  const value =
    request.kind === "inventory"
      ? {
          sessions: Object.entries(world.sessions).map(([sessionId, docs]) => ({
            sessionId,
            connected: true,
            openDocumentCount: docs.length,
            openDocuments: docs.map((doc) => ({ ...doc, isFamilyDocument: false })),
          })),
        }
      : request.kind === "machine"
        ? machineFixture(
            Object.entries(world.machine).map(([session, documents]) => ({
              session,
              documents: documents.map((doc) => ({
                ...doc,
                isFamilyDocument: false,
                isActive: true,
              })),
            })) as never,
          )
        : unreadable && request.kind === "work"
          ? undefined
          : { revision: 3, doc: { note: "hydrated" } };
  if (value === undefined)
    return { kind: "failure", key: readingKey(request), error: UNREADABLE_WORK } as never;
  return { kind: "snapshot", key: readingKey(request), value } as never;
};
const requests: ReadingRequest[] = [];
beforeEach(() => {
  world = { sessions: {}, machine: {} };
  unreadable = false;
  requests.length = 0;
  host.write.mockReset();
  host.fresh.mockReset();
  host.read.mockReset();
  host.write.mockResolvedValue({ ok: false, kind: "refused", error: "host", hint: "" });
  vi.spyOn(peReadings, "subscribe").mockImplementation((request, accept) => {
    requests.push(request);
    const id = readingKey(request);
    if (!accepts.has(id)) accepts.set(id, { request, live: new Set() });
    accepts.get(id)!.live.add(accept as never);
    accept(frame(request));
    return () => accepts.get(id)!.live.delete(accept as never);
  });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

async function probe(g: ReturnType<typeof graph>, search = "") {
  let ports: WorkScopePorts<{ note: string }> | null = null;
  const root = createRootRoute();
  const route = createRoute({
    getParentRoute: () => root,
    path: "/probe",
    validateSearch: routeSearch,
    component: () => {
      ports = useWorkScope(g);
      return null;
    },
  });
  const router = createRouter({
    routeTree: root.addChildren([route]),
    history: createMemoryHistory({ initialEntries: [`/probe${search}`] }),
  });
  await router.load();
  render(<RouterProvider router={router} />);
  act(() => {
    for (const { request, live } of accepts.values())
      for (const accept of live) accept(frame(request));
  });
  await waitFor(() => expect(ports?.status.resolution.kind).not.toBe("checking"));
  return () => ports!;
}
const pin = (target: unknown) => `?target=${encodeURIComponent(JSON.stringify(target))}`;

test("a Work-free graph resolves the host Target and reads no document", async () => {
  const ports = await probe(graph());
  expect(ports().status.resolution).toEqual({ kind: "resolved", target: { kind: "host" } });
  expect(ports().getSnapshot()).toEqual({ target: { kind: "host" }, work: null });
  expect(requests).toEqual([]);
  expect((await ports().write({} as never, {} as never)).ok).toBe(false);
});

test("an exact ?target document keys its Work by Address and hydrates the Work snapshot", async () => {
  world.sessions = { s1: [{ openId: "o1", title: "Level 1", address: DOC }] };
  const ref = { session: "s1", openId: "o1" };
  const ports = await probe(graph("document"), pin({ kind: "open", ref }));
  await waitFor(() => expect(ports().getSnapshot().work).not.toBeNull());
  const scope = ports().getSnapshot();
  expect(scope.target).toEqual({ kind: "document", ref });
  expect(scope.work).toEqual({
    handle: {
      key: { binding: "address", route: "scope-proof", target: DOC, from: ref },
      revision: 3,
    },
    doc: { note: "hydrated" },
  });
  expect(ports().status.closed).toBe(false);
  await ports().write(scope.work!.handle.key, { patches: [] } as never);
  expect(host.write).toHaveBeenCalledWith(scope.work!.handle.key, { patches: [] });
});

test("with no pin, the machine's sole user document is the fallback Target", async () => {
  world.sessions = { s1: [{ openId: "o1", title: "Level 1", address: DOC }] };
  world.machine = { s1: [{ openId: "o1", title: "Level 1", address: DOC }] };
  const ports = await probe(graph("document"));
  await waitFor(() => expect(ports().status.resolution.kind).toBe("resolved"));
  expect(ports().getSnapshot().target).toEqual({
    kind: "document",
    ref: { session: "s1", openId: "o1" },
  });
  expect(ports().status.targetProvenance).toEqual({ source: "sole-document" });
});

test("a session pin holding two documents is returned as choose, with no Work and no write", async () => {
  world.sessions = {
    s1: [
      { openId: "o1", title: "A", address: DOC },
      { openId: "o2", title: "B", address: address("C:/Jobs/B.rvt") },
    ],
  };
  const ports = await probe(graph("document"), "?target=s1");
  expect(ports().status.resolution).toEqual({ kind: "choose", reason: "ambiguous" });
  expect(ports().getSnapshot()).toEqual({ target: { kind: "host" }, work: null });
  expect(requests.some((request) => request.kind === "work")).toBe(false);
});

test("a closed exact document keeps its Work readable and refuses every write", async () => {
  world.sessions = { s1: [] };
  const ref = { session: "s1", openId: "gone" };
  const ports = await probe(graph("document"), pin({ kind: "open", ref }));
  await waitFor(() => expect(ports().getSnapshot().work).not.toBeNull());
  expect(ports().status).toMatchObject({
    resolution: { kind: "choose", reason: "document-closed" },
    closed: true,
  });
  const work = ports().getSnapshot().work!;
  expect(work.handle.key).toEqual({
    binding: "open",
    route: "scope-proof",
    target: null,
    open: ref,
  });
  expect(work.doc).toEqual({ note: "hydrated" });
  const result = await ports().write(work.handle.key, { patches: [] } as never);
  expect(result).toMatchObject({ ok: false, kind: "refused" });
  expect(host.write).not.toHaveBeenCalled();
  expect(await ports().startFresh(work.handle.key)).toMatchObject({ ok: false, kind: "refused" });
  expect(host.fresh).not.toHaveBeenCalled();
});

const STALE = { ok: false, kind: "refused", code: "stale_revision", error: "stale", hint: "" };
const base = graph("document");
const noted: typeof base = {
  ...base,
  verbs: {
    note: workVerb(
      { label: "note", input: z.strictObject({}).default({}), says: "write a note" },
      { patches: () => [{ path: ["note"], value: "human" }] },
    ),
  },
  stages: { one: { word: "One", panes: ["only"], verbs: ["note"] } },
};
const ack = (over: Partial<WorkWriteAck>): WorkWriteAck => ({
  key: undefined as never,
  kind: "apply",
  by: "pea",
  press: null,
  base: 3,
  revision: 4,
  patches: [{ path: ["note"], value: "pea" }],
  inverse: [{ path: ["note"], value: "hydrated" }],
  undoable: false,
  ...over,
});
const deliver = (kind: string, value: unknown) =>
  act(() => {
    for (const { request, live } of accepts.values())
      if (request.kind === kind)
        for (const accept of live)
          accept({ kind: "event", key: readingKey(request), value } as never);
  });

test("a stale write raises conflict; writing verbs and undo refuse until an accepted delta clears it", async () => {
  world.sessions = { s1: [{ openId: "o1", title: "Level 1", address: DOC }] };
  const ref = { session: "s1", openId: "o1" };
  const ports = await probe(noted, pin({ kind: "open", ref }));
  await waitFor(() => expect(ports().getSnapshot().work).not.toBeNull());
  const key = ports().getSnapshot().work!.handle.key;
  const owner = createGraphMount(noted, { sources: {}, ...ports() });
  const release = owner.connect();
  host.write.mockResolvedValue(STALE);
  expect(await owner.control("note").run()).toMatchObject({ state: "stale" });
  expect(owner.snapshot().conflict).toBe(true);
  // the same flag a Pea-written conflict raises: the owner's Work snapshot, not a per-caller state
  expect(owner.control("note").refusal).toBe("Work changed; review and retry");
  expect(await owner.control("note").run()).toMatchObject({
    state: "refused",
    refusal: { message: "Work changed; review and retry" },
  });
  expect(host.write).toHaveBeenCalledTimes(1);
  expect(await owner.restore("undo")).toMatchObject({ ok: false, code: "barrier" });
  expect(owner.journalRefusal()).toBe("Work changed; review and retry");
  deliver("work-acks", ack({ key }));
  expect(owner.snapshot().conflict).toBeUndefined();
  host.write.mockResolvedValue({
    ok: true,
    revision: 5,
    write: ack({ key, by: "human", press: "p", base: 4, revision: 5, undoable: true }),
  });
  expect(await owner.control("note").run()).toMatchObject({ state: "done" });
  expect(owner.journal(key).read().undo).toHaveLength(1);
  release();
  owner.dispose();
});

test("unreadable Work offers the start-fresh verb; its required confirm commits once and drops history", async () => {
  unreadable = true;
  world.sessions = { s1: [{ openId: "o2", title: "Level 2", address: address("C:/Jobs/L2.rvt") }] };
  const ref = { session: "s1", openId: "o2" };
  const ports = await probe(noted, pin({ kind: "open", ref }));
  await waitFor(() => expect(ports().status.unreadable).toBe(true));
  const key = ports().getSnapshot().unreadable!;
  expect(ports().getSnapshot().work).toBeNull();
  const owner = createGraphMount(noted, { sources: {}, ...ports() });
  expect(owner.verbs[START_FRESH_VERB]).toMatchObject({
    kind: "recovery",
    label: "Start fresh",
    review: "required",
  });
  expect(owner.control(START_FRESH_VERB).refusal).toBeNull();
  const review = await owner.control(START_FRESH_VERB).run();
  expect(review).toMatchObject({ state: "review", ticket: { evidence: { work: workKey(key) } } });
  expect(await owner.control(START_FRESH_VERB).run({})).toMatchObject({ state: "refused" });
  expect(owner.reviews.has(START_FRESH_VERB)).toBe(true);
  expect(host.fresh).not.toHaveBeenCalled();
  const accepted = ack({
    key,
    kind: "start-fresh",
    by: "human",
    base: 3,
    revision: 4,
    patches: [{ path: [], value: {} }],
    inverse: [],
    aside: "work.aside.json",
  });
  host.fresh.mockResolvedValue({ ok: true, revision: 4, write: accepted });
  const done = await owner.control(START_FRESH_VERB).run({ confirm: true });
  expect(done).toMatchObject({
    state: "done",
    kind: "recovery",
    acknowledgement: { aside: "work.aside.json" },
  });
  expect(host.fresh).toHaveBeenCalledTimes(1);
  expect(host.fresh).toHaveBeenCalledWith(key);
  expect(owner.journal(key).read()).toMatchObject({ revision: 4, undo: [], redo: [] });
  // The publication is a root barrier on the timeline, after the invocation that pressed it.
  expect(owner.timeline.read().map((entry) => entry.kind)).toEqual(["invocation", "receipt"]);
  expect(owner.timeline.read()[1]).toMatchObject({
    paths: [[]],
    basis: { workKey: workKey(key) },
  });
  // The review is spent: the next press opens a new one, it never commits.
  expect(await owner.control(START_FRESH_VERB).run({ confirm: true })).toMatchObject({
    state: "review",
  });
  expect(host.fresh).toHaveBeenCalledTimes(1);
  owner.dispose();
});

test("readable Work has nothing to start fresh", async () => {
  world.sessions = { s1: [{ openId: "o1", title: "Level 1", address: DOC }] };
  const ports = await probe(noted, pin({ kind: "open", ref: { session: "s1", openId: "o1" } }));
  await waitFor(() => expect(ports().getSnapshot().work).not.toBeNull());
  expect(ports().status.unreadable).toBe(false);
  const owner = createGraphMount(noted, { sources: {}, ...ports() });
  expect(owner.control(START_FRESH_VERB).refusal).toBe(
    "This Work is readable; there is nothing to recover",
  );
  expect(await owner.control(START_FRESH_VERB).run()).toMatchObject({ state: "refused" });
  expect(host.fresh).not.toHaveBeenCalled();
  owner.dispose();
});

// Real routeFromGraph, real door: Page's `ws` names the subject Work.
type Subject = { ws: string };
let latest: GraphMount<Subject, { note: string }> | null = null;
const subjectGraph: RouteGraph<Subject, { note: string }> = {
  key: "subject-proof",
  address: "subject-proof",
  name: "Subject proof",
  needs: "document",
  work: workSchema,
  workSubject: "ws",
  fields: { ws: { ...field(z.string().default(""), {}), role: "subject" } },
  readings: {},
  verbs: {
    note: workVerb(
      { label: "note", input: z.strictObject({}).default({}) },
      { patches: () => [{ path: ["note"], value: "human" }] },
    ),
    read: queryVerb(
      "schedule.grid.snapshot",
      {
        label: "Read",
        review: "none",
        input: z.strictObject({ scheduleId: z.number().int().default(7) }),
      },
      { subject: (value) => (value as { workspaceId: string }).workspaceId },
    ),
  },
  panes: { only: { label: "Only", purpose: "Proof", draws: [], verbs: ["read"] } },
  layout: pane("only"),
  stages: { one: { word: "One", panes: ["only"], verbs: ["note"] } },
};
const subjectRoute = routeFromGraph(
  subjectGraph,
  {
    sources: {},
    bodies: {
      only: ({ owner }) => {
        latest = owner;
        return <output aria-label="Body" />;
      },
    },
  },
  "/subject-proof",
);
const ref = { session: "s1", openId: "o1" };
async function mountSubject(search: string) {
  world.sessions = { s1: [{ openId: "o1", title: "Level 1", address: DOC }] };
  latest = null;
  const router = createRouter({
    routeTree: appRoot.addChildren([subjectRoute]),
    history: createMemoryHistory({ initialEntries: [`/subject-proof${search}`] }),
  });
  await router.load();
  const view = render(<RouterProvider router={router} />);
  await view.findByLabelText("Body");
  return { view, router, owner: () => latest! };
}
const workspaceRead = (work: string) =>
  requests.some(
    (request) =>
      request.kind === "work" && request.binding === "workspace" && request.work === work,
  );
const acked = (key: WorkKey, revision: number) => ({
  ok: true,
  revision,
  write: ack({ key, by: "human", press: "p", base: 3, revision, undoable: true }),
});

test("Page's workSubject selects the Work; a moved field moves the key and each key keeps its journal", async () => {
  const id = crypto.randomUUID();
  const { owner } = await mountSubject(`${pin({ kind: "open", ref })}&ws=a-${id}`);
  await waitFor(() =>
    expect(owner().snapshot().work?.handle.key).toMatchObject({ work: `a-${id}` }),
  );
  expect(workspaceRead(`a-${id}`)).toBe(true);
  const first = owner().snapshot().work!.handle.key;
  host.write.mockImplementation(async (key: WorkKey) => acked(key, 4));
  await act(async () => {
    expect(await owner().control("note").run()).toMatchObject({ state: "done" });
  });
  expect(host.write.mock.calls[0]![0]).toEqual(first);
  act(() => owner().view.setPage({ ws: `b-${id}` }));
  await waitFor(() =>
    expect(owner().snapshot().work?.handle.key).toMatchObject({ work: `b-${id}` }),
  );
  const second = owner().snapshot().work!.handle.key;
  await act(async () => {
    expect(await owner().control("note").run()).toMatchObject({ state: "done" });
  });
  expect(host.write.mock.calls[1]![0]).toEqual(second);
  // One journal per canonical key, retained while the owner lives.
  expect(owner().journal(first).read().undo).toHaveLength(1);
  expect(owner().journal(second).read().undo).toHaveLength(1);
  expect([...owner().journals.keys()]).toEqual([workKey(first), workKey(second)]);
});

test("an empty workSubject falls back to the ?work= carry, and a Page pick wins over it", async () => {
  const id = crypto.randomUUID();
  const { owner } = await mountSubject(`${pin({ kind: "open", ref })}&work=carry-${id}`);
  await waitFor(() =>
    expect(owner().snapshot().work?.handle.key).toMatchObject({ work: `carry-${id}` }),
  );
  act(() => owner().view.setPage({ ws: `pick-${id}` }));
  await waitFor(() =>
    expect(owner().snapshot().work?.handle.key).toMatchObject({ work: `pick-${id}` }),
  );
});

test("a query verb reads through the one invocation, records a receipt and selects the Work it names", async () => {
  const id = crypto.randomUUID();
  const { view, owner } = await mountSubject(`${pin({ kind: "open", ref })}&ws=a-${id}`);
  await waitFor(() => expect(owner().snapshot().work).not.toBeNull());
  host.read.mockResolvedValue({ id: "reading", workspaceId: `read-${id}` });
  const button = await waitFor(() => {
    const read = view.getByRole("button", { name: "Read" });
    expect(read.getAttribute("aria-disabled")).not.toBe("true");
    return read;
  });
  fireEvent.click(button);
  await waitFor(() => expect(owner().view.read().page.ws).toBe(`read-${id}`));
  expect(host.read).toHaveBeenCalledTimes(1);
  expect(host.read).toHaveBeenCalledWith(
    "schedule.grid.snapshot",
    { scheduleId: 7, maxRows: 200 },
    ref,
  );
  expect(host.write).not.toHaveBeenCalled();
  const entries = owner().timeline.read();
  expect(entries.map((entry) => entry.kind)).toEqual(["invocation", "receipt"]);
  expect(entries[1]).toMatchObject({
    press: entries[0]!.press,
    verb: "read",
    receiptId: `query:${entries[0]!.press}`,
    basis: { query: { key: "schedule.grid.snapshot", subject: `read-${id}`, state: "succeeded" } },
  });
  // A read names no Work paths, so it is no barrier.
  expect(entries[1]!.paths).toBeUndefined();
  expect(owner().results.get("read")).toMatchObject({ state: "done", kind: "query" });
  await waitFor(() =>
    expect(owner().snapshot().work?.handle.key).toMatchObject({ work: `read-${id}` }),
  );
  expect(workspaceRead(`read-${id}`)).toBe(true);
});

test("unreadable Work puts start-fresh on the stage; its review commits once through the kernel door", async () => {
  unreadable = true;
  const id = crypto.randomUUID();
  const { view, owner } = await mountSubject(`${pin({ kind: "open", ref })}&ws=broken-${id}`);
  const situation = within(await view.findByLabelText("Situation"));
  const button = await waitFor(() => {
    const fresh = situation.getByRole("button", { name: "Start fresh" });
    expect(fresh.getAttribute("aria-disabled")).not.toBe("true");
    return fresh;
  });
  const key = owner().snapshot().unreadable!;
  expect(key).toMatchObject({ binding: "workspace", work: `broken-${id}` });
  fireEvent.click(button);
  await situation.findByLabelText("Start fresh review");
  expect(host.fresh).not.toHaveBeenCalled();
  host.fresh.mockResolvedValue({
    ok: true,
    revision: 4,
    write: ack({ key, kind: "start-fresh", by: "human", revision: 4, patches: [], inverse: [] }),
  });
  fireEvent.click(situation.getByRole("button", { name: "Start fresh" }));
  await waitFor(() => expect(host.fresh).toHaveBeenCalledWith(key));
  await waitFor(() =>
    expect(owner().results.get(START_FRESH_VERB)).toMatchObject({
      state: "done",
      kind: "recovery",
    }),
  );
  expect(owner().timeline.read().at(-1)).toMatchObject({ paths: [[]] });
  expect(host.fresh).toHaveBeenCalledTimes(1);
});
