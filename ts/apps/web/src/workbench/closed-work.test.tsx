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
import { address, ductsRouteState, readingKey, routeAddress } from "@pe/agent-contracts";
import { z } from "zod";
import { peReadings } from "#/readings";
import { defineRoute } from "#/route/manifest";
import { routeSearch } from "#/shell/owner";
import { useRoute } from "#/route/use-route";
import { urlPage } from "#/route/url";

const DOC = address("C:/Review/Level 1.rvt");
const run = vi.fn(async () => null);
const action = (needs: "host" | "document") => ({
  label: needs,
  says: needs,
  needs,

  input: z.void() as unknown as z.ZodType<never>,
  dirties: [],
  requires: { work: true as const },
  ready: () => null,
  run,
});
const manifest = defineRoute({
  key: "ducts",
  name: "Ducts",
  address: "ducts",
  page: routeAddress("ducts").schema,
  work: ductsRouteState,
  needs: "document",
  // A placeholder target binds only to the natively resolved document: the native scope.
  readings: { takeoff: { kind: "takeoff-reading", target: { session: "", openId: "" } } },
  actions: { host: action("host"), doc: action("document") },
});
const url = urlPage(manifest)!;

let handle: ReturnType<typeof useDuct> | null = null;
// A `?target` Address pin, as a route passes its chosen target.
let pin: string = DOC;
const useDuct = () => useRoute(manifest, { target: pin });
function Probe() {
  handle = useDuct();
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
  await waitFor(() => expect(handle?.resolution.kind).not.toBe("checking"));
}
const workReads = () => requests.filter((item) => item.kind === "work");
const nativeReads = () => requests.filter((item) => item.kind === "takeoff-reading");

test("a closed document's Work reads through its Address and arms nothing", async () => {
  open = false;
  await mount();
  await waitFor(() => expect(handle!.work.current).toBe(true));
  expect(handle!.resolution).toMatchObject({ kind: "choose", reason: "document-closed" });
  expect(workReads().at(-1)!.request).toMatchObject({ binding: "address", target: DOC });
  expect(handle!.work.doc).not.toBeNull();
  // Nothing native: no bound reading, no runnable action, no write.
  expect(nativeReads()).toHaveLength(0);
  expect(handle!.actions.host.refusal).toMatch(/closed/);
  expect(handle!.actions.doc.refusal).not.toBeNull();
  expect((await handle!.work.write([]))?.message).toMatch(/closed/);
  expect(run).not.toHaveBeenCalled();
});

test("an open document keys, binds and arms exactly as before", async () => {
  open = true;
  await mount();
  await waitFor(() => expect(handle!.work.current).toBe(true));
  expect(handle!.resolution).toMatchObject({ kind: "resolved" });
  // The same persisted Work the closed document read, now carrying its live lifetime.
  expect(handle!.work.key).toMatchObject({
    binding: "address",
    target: DOC,
    from: { session: "s1", openId: "o1" },
  });
  await waitFor(() =>
    expect(nativeReads().at(-1)!.request).toMatchObject({
      target: { session: "s1", openId: "o1" },
    }),
  );
  expect(handle!.actions.host.refusal).toBeNull();
  expect(handle!.actions.doc.refusal).toBeNull();
});

test("closed open-bound Work: an exact open pin reads its own lifetime's Work and arms nothing", async () => {
  open = false;
  // The exact open request the page was bound to; its document is no longer in the inventory.
  pin = JSON.stringify({ kind: "open", ref: { session: "s1", openId: "o9" } });
  await mount();
  await waitFor(() => expect(handle!.work.current).toBe(true));
  expect(handle!.resolution.kind).not.toBe("resolved");
  expect(handle!.work.key).toMatchObject({
    binding: "open",
    open: { session: "s1", openId: "o9" },
  });
  expect(handle!.work.doc).not.toBeNull();
  // No native scope and nothing reachable: every action refuses, running one runs nothing.
  expect(nativeReads()).toHaveLength(0);
  for (const action of Object.values(handle!.actions)) {
    expect(action.refusal).not.toBeNull();
    expect(await act(() => action.run())).not.toBeNull();
  }
  expect(run).not.toHaveBeenCalled();
  expect((await handle!.work.write([]))?.message).toMatch(/closed|no longer open|pick it again/);
});
