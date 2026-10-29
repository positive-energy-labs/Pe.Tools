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
  type ReadingRequest,
  type RouteGraph,
} from "@pe/agent-contracts";
import { machineFixture } from "../../../../packages/agent-contracts/tests/machine-fixture.ts";
import { peReadings } from "#/readings";
import { routeSearch } from "../route/route-owner";
import { useWorkScope, type WorkScopePorts } from "./use-work-scope";

const host = vi.hoisted(() => ({ write: vi.fn() }));
vi.mock("../route/host", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../route/host")>()),
  writeRouteWork: host.write,
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
        : { revision: 3, doc: { note: "hydrated" } };
  return { kind: "snapshot", key: readingKey(request), value } as never;
};
const requests: ReadingRequest[] = [];
beforeEach(() => {
  world = { sessions: {}, machine: {} };
  requests.length = 0;
  host.write.mockReset();
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
});
