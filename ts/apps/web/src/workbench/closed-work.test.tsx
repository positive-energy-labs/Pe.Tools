// @vitest-environment jsdom
import { act, cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vite-plus/test";
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import { address, ductsRouteState, readingKey } from "@pe/agent-contracts";
import { z } from "zod";
import { peReadings } from "#/readings";
import { useEffect } from "react";
import { ductsGraph } from "#/ducts/graph";
import { useGraphRoute } from "#/shell/mount";
import { graphUrlPage } from "#/shell/mount-page";
import { subscriptionSource } from "#/shell/readings-use";
import { workVerb } from "#/shell/verbs";
import { routeSearch } from "#/shell/owner";

const DOC = address("C:/Review/Level 1.rvt");
const run = vi.fn(async () => null);
const action = (label: string) =>
  workVerb(
    { label, input: z.object({}).default({}) },
    {
      patches: () => {
        void run();
        return [];
      },
    },
  );
const graph: typeof ductsGraph = {
  ...ductsGraph,
  fields: Object.fromEntries(
    Object.entries(ductsGraph.fields).map(([id, value]) => [id, { ...value, picker: undefined }]),
  ) as typeof ductsGraph.fields,
  needs: "document" as const,
  work: ductsRouteState.schema,
  cells: undefined,
  observe: undefined,
  readings: { takeoff: { kind: "use" as const, source: "takeoff", retire: "target" as const } },
  verbs: { host: action("host"), doc: action("document") },
  layout: { kind: "pane" as const, id: "probe" },
  panes: { probe: { label: "Probe", purpose: "Closed Work", draws: ["takeoff"], verbs: [] } },
  stageOrder: ["probe"],
  stages: { probe: { word: "Probe", panes: ["probe"], verbs: [] } },
};
const url = graphUrlPage(graph);
const adapters = {
  bodies: {},
  sources: {
    takeoff: {
      kind: "use" as const,
      open(
        ctx: Parameters<ReturnType<typeof subscriptionSource>["open"]>[0],
        deliver: Parameters<ReturnType<typeof subscriptionSource>["open"]>[1],
      ) {
        if (ctx.target.kind !== "document") return;
        return subscriptionSource({
          request: () => ({
            kind: "takeoff-reading",
            target: ctx.target.kind === "document" ? ctx.target.ref : { session: "", openId: "" },
          }),
          decode: (v) => v,
        }).open(ctx, deliver);
      },
    },
  },
};
let handle: ReturnType<typeof useDuct> | null = null;
let pin: string = DOC;
const useDuct = () => useGraphRoute(graph, adapters, { target: pin });
function Probe() {
  handle = useDuct();
  const owner = handle.owner;
  useEffect(() => owner.readings.mount(["takeoff"]), [owner]);
  return null;
}

const requests: { kind: string; key: string; request: Record<string, unknown> }[] = [];
let open = false;
// The inventory Reading outlives one test in the shared registry: each test pushes its own world.
const inventory = new Set<(frame: never) => void>();
const inventorySnapshot = () =>
  ({
    kind: "snapshot",
    key: readingKey({ kind: "inventory" }),
    value: {
      sessions: [
        {
          sessionId: "s1",
          connected: true,
          openDocumentCount: open ? 1 : 0,
          openDocuments: open
            ? [{ openId: "o1", title: "Level 1", address: DOC, isFamilyDocument: false }]
            : [],
        },
      ],
    },
  }) as never;
beforeEach(() => {
  pin = DOC;
  handle = null;
  requests.length = 0;
  vi.spyOn(peReadings, "subscribe").mockImplementation((request, accept) => {
    requests.push({ kind: request.kind, key: readingKey(request), request: request as never });
    if (request.kind === "inventory") {
      inventory.add(accept);
      accept(inventorySnapshot());
    }
    if (request.kind === "work")
      accept({
        kind: "snapshot",
        key: readingKey(request),
        value: { revision: 3, doc: ductsRouteState.schema.parse({ assumptions: {} }) },
      } as never);
    return () => {};
  });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

async function mount() {
  const root = createRootRoute();
  const ducts = createRoute({
    getParentRoute: () => root,
    path: "/ducts",
    component: Probe,
    validateSearch: (search) => ({ ...routeSearch(search), ...url.read(search) }),
    search: { middlewares: [...url.middlewares] },
  });
  const router = createRouter({
    routeTree: root.addChildren([ducts]),
    history: createMemoryHistory({ initialEntries: ["/ducts"] }),
  });
  await router.load();
  render(<RouterProvider router={router} />);
  act(() => inventory.forEach((accept) => accept(inventorySnapshot())));
  await waitFor(() => expect(handle?.status.resolution.kind).not.toBe("checking"));
}
const workReads = () => requests.filter((item) => item.kind === "work");
const nativeReads = () => requests.filter((item) => item.kind === "takeoff-reading");

test("a closed document's Work reads through its Address and arms nothing", async () => {
  open = false;
  await mount();
  await waitFor(() => expect(handle!.owner.snapshot().work).not.toBeNull());
  expect(handle!.status.resolution).toMatchObject({ kind: "choose", reason: "document-closed" });
  expect(workReads().at(-1)!.request).toMatchObject({ binding: "address", target: DOC });
  expect(handle!.owner.snapshot().work!.doc).not.toBeNull();
  // Nothing native: no bound reading, no runnable action, no write.
  expect(nativeReads()).toHaveLength(0);
  expect(handle!.owner.control("host").refusal).toMatch(/closed|inactive/);
  expect(handle!.owner.control("doc").refusal).not.toBeNull();
  expect(
    ((await handle!.owner.control("host").run()) as { refusal: { message: string } }).refusal
      .message,
  ).toMatch(/closed|inactive/);
  expect(run).not.toHaveBeenCalled();
});

test("an open document keys, binds and arms exactly as before", async () => {
  open = true;
  await mount();
  await waitFor(() => expect(handle!.owner.snapshot().work).not.toBeNull());
  expect(handle!.status.resolution).toMatchObject({ kind: "resolved" });
  // The same persisted Work the closed document read, now carrying its live lifetime.
  expect(handle!.owner.snapshot().work!.handle.key).toMatchObject({
    binding: "address",
    target: DOC,
    from: { session: "s1", openId: "o1" },
  });
  await waitFor(() =>
    expect(nativeReads().at(-1)!.request).toMatchObject({
      target: { session: "s1", openId: "o1" },
    }),
  );
  expect(handle!.owner.control("host").refusal).toBeNull();
  expect(handle!.owner.control("doc").refusal).toBeNull();
});

test("closed open-bound Work: an exact open pin reads its own lifetime's Work and arms nothing", async () => {
  open = false;
  // The exact open request the page was bound to; its document is no longer in the inventory.
  pin = JSON.stringify({ kind: "open", ref: { session: "s1", openId: "o9" } });
  await mount();
  await waitFor(() => expect(handle!.owner.snapshot().work).not.toBeNull());
  expect(handle!.status.resolution.kind).not.toBe("resolved");
  expect(handle!.owner.snapshot().work!.handle.key).toMatchObject({
    binding: "open",
    open: { session: "s1", openId: "o9" },
  });
  expect(handle!.owner.snapshot().work!.doc).not.toBeNull();
  // No native scope and nothing reachable: every action refuses, running one runs nothing.
  expect(nativeReads()).toHaveLength(0);
  for (const action of [handle!.owner.control("host"), handle!.owner.control("doc")]) {
    expect(action.refusal).not.toBeNull();
    expect(await act(() => action.run())).not.toBeNull();
  }
  expect(run).not.toHaveBeenCalled();
  expect(
    ((await handle!.owner.control("host").run()) as { refusal: { message: string } }).refusal
      .message,
  ).toMatch(/closed|no longer open|pick it again|inactive/);
});
