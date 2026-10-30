// @vitest-environment jsdom
import { act, cleanup, render, waitFor } from "@testing-library/react";
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
  UNREADABLE_WORK,
  type ReadingRequest,
  type RouteGraph,
  type WorkWriteAck,
} from "@pe/agent-contracts";
import { machineFixture } from "../../../../packages/agent-contracts/tests/machine-fixture.ts";
import { peReadings } from "#/readings";
import { routeSearch } from "../route/route-owner";
import { createGraphMount } from "./mount-owner";
import { workVerb } from "./verbs";
import { useWorkScope, type WorkScopePorts } from "./use-work-scope";

const host = vi.hoisted(() => ({ write: vi.fn(), fresh: vi.fn() }));
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

test("unreadable Work offers one startFresh review; commit advances the revision and the journal drops history", async () => {
  unreadable = true;
  world.sessions = { s1: [{ openId: "o2", title: "Level 2", address: address("C:/Jobs/L2.rvt") }] };
  const ref = { session: "s1", openId: "o2" };
  const ports = await probe(noted, pin({ kind: "open", ref }));
  await waitFor(() => expect(ports().status.unreadable).toBe(true));
  const key = ports().getSnapshot().unreadable!;
  expect(ports().getSnapshot().work).toBeNull();
  const owner = createGraphMount(noted, { sources: {}, ...ports() });
  expect(owner.startFresh).toMatchObject({ label: "Start fresh", review: "required" });
  expect(owner.startFresh.refusal).toBeNull();
  expect(await owner.startFresh.commit({ confirm: true })).toMatchObject({ state: "refused" });
  expect(owner.startFresh.begin()).toMatchObject({ state: "review" });
  expect(await owner.startFresh.commit({})).toMatchObject({ state: "refused" });
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
  const done = await owner.startFresh.commit({ confirm: true });
  expect(done).toMatchObject({ state: "done", acknowledgement: { aside: "work.aside.json" } });
  expect(host.fresh).toHaveBeenCalledWith(key);
  expect(owner.journal(key).read()).toMatchObject({ revision: 4, undo: [], redo: [] });
  // the review is spent: a second commit needs a new ticket
  expect(await owner.startFresh.commit({ confirm: true })).toMatchObject({ state: "refused" });
  owner.dispose();
});

test("readable Work has nothing to start fresh", async () => {
  world.sessions = { s1: [{ openId: "o1", title: "Level 1", address: DOC }] };
  const ports = await probe(noted, pin({ kind: "open", ref: { session: "s1", openId: "o1" } }));
  await waitFor(() => expect(ports().getSnapshot().work).not.toBeNull());
  expect(ports().status.unreadable).toBe(false);
  const owner = createGraphMount(noted, { sources: {}, ...ports() });
  expect(owner.startFresh.begin()).toMatchObject({ state: "refused" });
  owner.dispose();
});
