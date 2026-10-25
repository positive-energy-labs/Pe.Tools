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
import { RegistryContext } from "@effect/atom-react";
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
  link: routeAddress("ducts").link({ system: ["S1"] } as never),
  at: "2026-10-24T00:00:00.000Z",
};
const TAB = `${routeAddress("ducts").title} · S1`;
// Three Places on the one tool, each on its own document and its own non-default Page.
const DOC_A = address("C:/Jobs/Level A.rvt"),
  DOC_B = address("C:/Jobs/Level B.rvt");
const place = (id: string, system: string, selected: string, target: unknown): ThreadTab => ({
  id,
  route: "ducts",
  link: routeAddress("ducts").link({ system: [system], selected } as never, {
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
vi.mock("#/chat/chat-shell", () => ({ ChatShell: () => <div data-chat-probe="" /> }));
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
  render(
    <RegistryContext.Provider value={appAtomRegistry}>
      <RouterProvider router={router} />
    </RegistryContext.Provider>,
  );
  await screen.findByRole("button", { name: "Expand tools" });
  return router;
}
const tools = () => document.querySelector<HTMLElement>('[data-pane-id="tools"]')!;

test("a thread opens its conversation with Pea first and the tools collapsed, no tool opened", async () => {
  const router = await mount();
  await act(() => new Promise((done) => setTimeout(done, 50)));
  expect(router.state.location.pathname).toBe("/pea");
  expect(screen.getByRole("button", { name: TAB, hidden: true }).getAttribute("aria-pressed")).toBe(
    "false",
  );
  const pea = document.querySelector("[data-chat-probe]")!;
  expect(pea.querySelector('[role="group"][aria-label="Thread Places"]')).toBeNull();
  expect(screen.getByRole("button", { name: "Expand tools" })).toBeTruthy();
  expect(tools().closest(".hidden")).toBeTruthy();
  expect(document.body.textContent).not.toMatch(/tools collapsed/i);
  expect(pea.compareDocumentPosition(tools()) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(mounts).toBe(0);
});

test("a tab press expands the tools on that Place; a Work press restores its Page without a remount", async () => {
  const router = await mount();
  fireEvent.click(screen.getByRole("button", { name: "Expand tools" }));
  fireEvent.click(screen.getByRole("button", { name: TAB }));
  await waitFor(() => expect(router.state.location.pathname).toBe("/ducts"));
  await waitFor(() => expect(screen.getByText("S1")).toBeTruthy());
  expect(tools().closest(".hidden")).toBeNull();
  expect(tools().querySelector('[role="group"][aria-label="Thread Places"]')).toBeTruthy();
  expect(mounts).toBe(1);

  await act(() => router.navigate({ to: "/pea", search: { thread: "T" } } as never));
  expect(tools().closest(".hidden")).toBeTruthy();
  await act(() =>
    store.actions.openWork("T", "ducts", {
      key: { binding: "host", route: "ducts", target: null },
      url: "/ducts",
      reason: null,
      matches: [{ threadId: "T", tabId: "tab-ducts" }],
    }),
  );
  await waitFor(() => expect(router.state.location.pathname).toBe("/ducts"));
  expect((router.state.location.search as { system?: string }).system).toBe("S1");
  // A Work press is outside the tools bar: focus lands on the tool's pane.
  expect(document.activeElement).toBe(tools());
  expect(document.querySelector("[data-chat-probe]")).toBeTruthy();
  expect(mounts).toBe(1);
});

// Host-shaped `work.resume` answers: `matches` are the host's Places for this Work, in canonical
// tab order per thread; the web never derives them.
const resume = (
  key: WorkKey,
  url = "/ducts",
  matches: { threadId: string; tabId: string }[] = [],
) => ({ key, url, reason: null, matches });
const shown = (router: Awaited<ReturnType<typeof mount>>) => ({
  path: router.state.location.pathname,
  system: (router.state.location.search as { system?: string }).system,
  selected: String((router.state.location.search as { selected?: unknown }).selected ?? ""),
  target: (router.state.location.search as { target?: string }).target,
  tab: (router.state.location.state as { __peRouteTab?: { id: string } }).__peRouteTab?.id ?? null,
});
const press = (resumed: ReturnType<typeof resume>) =>
  act(() => store.actions.openWork("T", "ducts", resumed));

test("two documents on one tool: each Work's match restores its own tab's Page and id", async () => {
  const router = await mount();
  // The host's base url never wins over the Place it matched.
  await press(
    resume({ binding: "address", route: "ducts", target: DOC_B }, "/ducts?system=base", [
      { threadId: "T", tabId: "tab-b" },
    ]),
  );
  await waitFor(() => expect(shown(router)).toMatchObject({ system: "SB", tab: "tab-b" }));
  expect(shown(router).selected).toBe("202");
  await press(
    resume({ binding: "address", route: "ducts", target: DOC_A }, "/ducts?system=base", [
      { threadId: "T", tabId: "tab-a" },
      { threadId: "T", tabId: "tab-b" },
    ]),
  );
  // Canonical tab order: the first match in this thread.
  await waitFor(() => expect(shown(router)).toMatchObject({ system: "SA", tab: "tab-a" }));
  expect(shown(router).selected).toBe("101");
});

test("no match, or another thread's Place, opens a new Place in this thread", async () => {
  const router = await mount();
  const key = {
    binding: "address",
    route: "ducts",
    target: address("C:/Jobs/Level C.rvt"),
  } as const;
  await press(resume(key, "/ducts?system=SC"));
  await waitFor(() => expect(shown(router)).toMatchObject({ path: "/ducts", system: "SC" }));
  expect(["tab-ducts", "tab-a", "tab-b", "tab-open"]).not.toContain(shown(router).tab);
  // A match naming another thread's tab never pulls it here, even when this thread holds that id.
  await press(resume(key, "/ducts?system=SX", [{ threadId: "OTHER", tabId: "tab-a" }]));
  await waitFor(() => expect(shown(router).system).toBe("SX"));
  expect(shown(router).tab).not.toBe("tab-a");
});

test("a SaveAs ref with two known Addresses gets no match from the host: a new Place", async () => {
  // The host gives `matches: []` for an open ref whose lifetime knew two Addresses.
  const router = await mount();
  await press(
    resume(
      { binding: "address", route: "ducts", target: address("C:/Jobs/Saved As.rvt") },
      "/ducts?system=SAS",
    ),
  );
  await waitFor(() => expect(shown(router).system).toBe("SAS"));
  expect(shown(router).tab).not.toBe("tab-open");
});

test("every Place carries its own named close, in the tab order", async () => {
  await mount();
  fireEvent.click(screen.getByRole("button", { name: "Expand tools" }));
  for (const name of ["Ducts · S1", "Ducts · SA", "Ducts · SB", "Ducts · SO"]) {
    const close = screen.getByRole("button", { name: `Close ${name}` });
    expect(close.tabIndex).not.toBe(-1);
    close.focus();
    expect(document.activeElement).toBe(close);
  }
  expect(screen.queryByRole("button", { name: "Close this Place" })).toBeNull();
});

test("parent-r2 receipt: the host's base url never replaces the matched Place's retained Page", async () => {
  const router = await mount();
  await press(
    resume(
      { binding: "address", route: "ducts", target: address(String.raw`c:\models\office.rvt`) },
      "/ducts?target=c%3A%5Cmodels%5Coffice.rvt",
      [{ threadId: "T", tabId: "cac00000-0000-4000-8000-000000000011" }],
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

// Was the known gap: the producer's address key carries no `from`, so only the host's `matches`
// can say this open-ref Place holds the Work. The legacy Place keeps its Page and id, and its
// binding carry rebases onto the resume's stable Address so the Work stays readable once closed.
test("an address key with no `from` restores the matched open-ref Place, rebased onto the stable Address", async () => {
  const router = await mount();
  const stable = "/ducts?target=C%3A%2FJobs%2FOpen.rvt";
  await press(
    resume(
      { binding: "address", route: "ducts", target: address(String.raw`c:\jobs\open.rvt`) },
      stable,
      [{ threadId: "T", tabId: "tab-open" }],
    ),
  );
  await waitFor(() => expect(shown(router)).toMatchObject({ system: "SO", tab: "tab-open" }));
  expect(shown(router).selected).toBe("303");
  expect(shown(router).target).toBe("C:/Jobs/Open.rvt");
});

test("a Work pressed on a closed document shows what is kept and how to reconnect", async () => {
  const router = await mount();
  await act(() =>
    store.actions.openWork(
      "T",
      "ducts",
      {
        ...resume({ binding: "address", route: "ducts", target: DOC_A }),
        reason: "Office host said so",
      },
      {
        documentId: "doc-office",
        document: "Office.rvt",
        intent: "Size the office",
        unfinished: 3,
      },
    ),
  );
  await waitFor(() => expect(router.state.location.pathname).toBe("/ducts"));
  const band = document.querySelector<HTMLElement>("[data-closed-work]")!;
  expect(band.textContent).toContain("Office.rvt is closed");
  expect(band.textContent).toContain("3 unfinished");
  expect(band.textContent).toContain("Size the office");
  expect(band.textContent).toContain("Office host said so");
  // Saved or never saved: nothing promises the same file reopens.
  expect(band.textContent).toContain("Work is kept, read-only, while its document is closed.");
  expect(band.textContent).not.toMatch(/reopen|same file/i);
  // The route thread's strict browser assertion, matched by the surface itself.
  expect(band.textContent).toMatch(/closed|reconnect|not open|choose.*document/i);
  expect(screen.getByRole("button", { name: "Open or choose a document in Revit" })).toBeTruthy();
  // An open document's Work press clears it.
  await act(() =>
    store.actions.openWork(
      "T",
      "ducts",
      resume({ binding: "address", route: "ducts", target: DOC_B }),
    ),
  );
  await waitFor(() => expect(document.querySelector("[data-closed-work]")).toBeNull());
});
