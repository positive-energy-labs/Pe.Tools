// @vitest-environment jsdom
import { createContext, useState } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vite-plus/test";
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
  useRouterState,
} from "@tanstack/react-router";
import { address, routeAddress, type ThreadTab, type WorkKey } from "@pe/agent-contracts";
import { appAtomRegistry } from "#/route/route-owner";
import { createChatPageStore } from "./store";
import { RouteDock } from "./route-panes";

const store = createChatPageStore({
  registry: appAtomRegistry,
  search: { mode: "threads", patch: async () => {} },
});
const ducts: ThreadTab = {
  id: "tab-ducts",
  route: "ducts",
  link: routeAddress("ducts").link({ system: "S1" } as never),
  at: "2026-10-24T00:00:00.000Z",
};
const TAB = `${routeAddress("ducts").title} · S1`;
// Three Places on the one tool, each on its own document and its own non-default Page.
const DOC_A = address("C:/Jobs/Level A.rvt"),
  DOC_B = address("C:/Jobs/Level B.rvt");
const place = (id: string, system: string, selected: string, target: unknown): ThreadTab => ({
  id,
  route: "ducts",
  link: routeAddress("ducts").link({ system, selected } as never, {
    target: JSON.stringify(target),
  }),
  at: "2026-10-24T00:00:00.000Z",
});
const tabA = place("tab-a", "SA", "101", { kind: "named", session: "s1", address: DOC_A });
const tabB = place("tab-b", "SB", "202", { kind: "named", session: "s1", address: DOC_B });
const tabOpen = place("tab-open", "SO", "303", {
  kind: "open",
  ref: { session: "s1", openId: "o1" },
});
// The route thread's browser receipt (parent-r2 seed): a raw Address pin with a retained Page.
const tabOffice: ThreadTab = {
  id: "cac00000-0000-4000-8000-000000000011",
  route: "ducts",
  link: "/ducts?target=C%3A%2FModels%2FOffice.rvt&system=Office%20retained%20page",
  at: "2026-10-24T00:00:00.000Z",
};
const threads = [{ id: "T", tabs: [ducts, tabA, tabB, tabOpen, tabOffice] }];
vi.mock("./provider", () => ({ useWorkbench: () => ({ store, threads }) }));
vi.mock("#/chat/chat-shell", () => ({ ChatShell: () => <div data-chat-probe="">pea</div> }));
vi.mock("#/route/situation-ladder", () => ({ ChatPlanIntent: createContext(null) }));
vi.mock("#/readings", () => ({
  useReading: () => ({ state: "pending" }),
  previousOf: () => undefined,
}));
vi.mock("#/navigation/surface-host", () => ({ useSurfaceHost: () => ({ surface: "web" }) }));
vi.mock("#/host/pe-client", () => ({
  peClient: { call: vi.fn(async () => ({ tabs: [ducts] })) },
}));

let mounts = 0;
function DuctsProbe() {
  useState(() => ++mounts);
  const system = useRouterState({
    select: (state) => (state.location.search as { system?: string }).system,
  });
  return <output data-ducts-probe="">{system}</output>;
}

beforeEach(() => {
  mounts = 0;
  vi.stubGlobal("matchMedia", () => ({
    matches: false,
    addEventListener() {},
    removeEventListener() {},
  }));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

async function mount() {
  const root = createRootRoute({
    component: () => <RouteDock renderRoute={(body) => body}>{null}</RouteDock>,
  });
  const routes = [
    createRoute({ getParentRoute: () => root, path: "/pea" }),
    createRoute({ getParentRoute: () => root, path: "/ducts", component: DuctsProbe }),
  ];
  const router = createRouter({
    routeTree: root.addChildren(routes),
    history: createMemoryHistory({ initialEntries: ["/pea?thread=T"] }),
  });
  await router.load();
  render(<RouterProvider router={router} />);
  await screen.findByRole("button", { name: TAB });
  return router;
}
const tools = () => document.querySelector<HTMLElement>('[data-pane-id="tools"]')!;

test("a thread opens its conversation with Pea first and the tools collapsed, no tool opened", async () => {
  const router = await mount();
  await act(() => new Promise((done) => setTimeout(done, 50)));
  expect(router.state.location.pathname).toBe("/pea");
  expect(screen.getByRole("button", { name: TAB }).getAttribute("aria-pressed")).toBe("false");
  expect(screen.getByText("tools collapsed")).toBeTruthy();
  const pea = document.querySelector("[data-chat-probe]")!;
  expect(pea.compareDocumentPosition(tools()) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(mounts).toBe(0);
});

test("a tab press expands the tools on that Place; a Work press restores its Page without a remount", async () => {
  const router = await mount();
  fireEvent.click(screen.getByRole("button", { name: TAB }));
  await waitFor(() => expect(router.state.location.pathname).toBe("/ducts"));
  await waitFor(() => expect(screen.getByText("S1")).toBeTruthy());
  expect(screen.queryByText("tools collapsed")).toBeNull();
  expect(mounts).toBe(1);

  await act(() => router.navigate({ to: "/pea", search: { thread: "T" } } as never));
  expect(screen.getByText("tools collapsed")).toBeTruthy();
  await act(() =>
    store.actions.openWork("T", "ducts", {
      key: { binding: "host", route: "ducts", target: null },
      url: "/ducts",
      reason: null,
    }),
  );
  await waitFor(() => expect(router.state.location.pathname).toBe("/ducts"));
  expect((router.state.location.search as { system?: string }).system).toBe("S1");
  // A Work press is outside the tools bar: focus lands on the tool's pane.
  expect(document.activeElement).toBe(tools());
  expect(document.querySelector("[data-chat-probe]")).toBeTruthy();
  expect(mounts).toBe(1);
});

const resume = (key: WorkKey, url = "/ducts") => ({ key, url, reason: null });
const shown = (router: Awaited<ReturnType<typeof mount>>) => ({
  path: router.state.location.pathname,
  system: (router.state.location.search as { system?: string }).system,
  selected: String((router.state.location.search as { selected?: unknown }).selected ?? ""),
  tab: (router.state.location.state as { __peRouteTab?: { id: string } }).__peRouteTab?.id ?? null,
});

test("two documents on one tool: each Work restores its own tab's Page and id", async () => {
  const router = await mount();
  const work = (target: typeof DOC_A) =>
    act(() =>
      store.actions.openWork(
        "T",
        "ducts",
        // The host's base url never wins over the tab that holds this Work.
        resume({ binding: "address", route: "ducts", target }, "/ducts?system=base"),
      ),
    );
  await work(DOC_B);
  await waitFor(() => expect(shown(router)).toMatchObject({ system: "SB", tab: "tab-b" }));
  expect(shown(router).selected).toBe("202");
  await work(address(String.raw`c:\JOBS\level a.rvt`));
  await waitFor(() => expect(shown(router)).toMatchObject({ system: "SA", tab: "tab-a" }));
  expect(shown(router).selected).toBe("101");
});

test("an open document's Work keeps its non-default Page by its exact open lifetime", async () => {
  const router = await mount();
  await act(() =>
    store.actions.openWork(
      "T",
      "ducts",
      resume({
        binding: "address",
        route: "ducts",
        target: address("C:/Jobs/Open.rvt"),
        from: { session: "s1", openId: "o1" },
      }),
    ),
  );
  await waitFor(() => expect(shown(router)).toMatchObject({ system: "SO", tab: "tab-open" }));
  expect(shown(router).selected).toBe("303");
});

test("a Work no tab holds opens its url as a new Place, never another Work's tab", async () => {
  const router = await mount();
  await act(() =>
    store.actions.openWork(
      "T",
      "ducts",
      resume(
        { binding: "address", route: "ducts", target: address("C:/Jobs/Level C.rvt") },
        "/ducts?system=SC",
      ),
    ),
  );
  await waitFor(() => expect(shown(router)).toMatchObject({ path: "/ducts", system: "SC" }));
  expect(["tab-ducts", "tab-a", "tab-b", "tab-open"]).not.toContain(shown(router).tab);
  // A different lifetime of an open ref, or a session alone, is not that tab's Work either.
  await act(() =>
    store.actions.openWork(
      "T",
      "ducts",
      resume({
        binding: "open",
        route: "ducts",
        target: null,
        open: { session: "s1", openId: "o2" },
      }),
    ),
  );
  await waitFor(() => expect(shown(router).system).toBeUndefined());
  expect(shown(router).tab).not.toBe("tab-open");
});

test("every Place carries its own named close, in the tab order", async () => {
  await mount();
  for (const name of ["Ducts · S1", "Ducts · SA", "Ducts · SB", "Ducts · SO"]) {
    const close = screen.getByRole("button", { name: `Close ${name}`, exact: true });
    expect(close.tabIndex).not.toBe(-1);
    close.focus();
    expect(document.activeElement).toBe(close);
  }
  expect(screen.queryByRole("button", { name: "Close this Place" })).toBeNull();
});

test("parent-r2 receipt: the host's base url never replaces the saved Place's retained Page", async () => {
  const router = await mount();
  await act(() =>
    store.actions.openWork(
      "T",
      "ducts",
      resume(
        { binding: "address", route: "ducts", target: address(String.raw`c:\models\office.rvt`) },
        "/ducts?target=c%3A%5Cmodels%5Coffice.rvt",
      ),
    ),
  );
  await waitFor(() =>
    expect(shown(router)).toMatchObject({
      path: "/ducts",
      system: "Office retained page",
      tab: "cac00000-0000-4000-8000-000000000011",
    }),
  );
});

// KNOWN GAP, waits for the route thread's `WorkResume.matches` ({threadId, tabId}[], host-derived).
// The producer (`storedWorkKey`, packages/runtime/src/route-workspace.ts:555) decodes an address
// WorkKey with no `from`, so an exact open-ref Place cannot prove it holds that Work from the key
// alone. No web-side guess fills it: today this press opens a fresh Place. `test.fails` flips red
// when the gap closes, so the expectation below becomes the live assertion.
test.fails("known gap: an address key with no `from` restores the open-ref Place holding its Page", async () => {
  const router = await mount();
  await act(() =>
    store.actions.openWork(
      "T",
      "ducts",
      resume({ binding: "address", route: "ducts", target: address(String.raw`c:\jobs\open.rvt`) }),
    ),
  );
  await waitFor(() => expect(shown(router)).toMatchObject({ system: "SO", tab: "tab-open" }), {
    timeout: 1500,
  });
});
