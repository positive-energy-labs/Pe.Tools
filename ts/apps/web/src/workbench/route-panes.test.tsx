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
  id: "aaaaaaaa-0000-4000-8000-000000000001",
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
const tabA = place("aaaaaaaa-0000-4000-8000-00000000000a", "SA", "101", {
  kind: "named",
  session: "s1",
  address: DOC_A,
});
const tabB = place("aaaaaaaa-0000-4000-8000-00000000000b", "SB", "202", {
  kind: "named",
  session: "s1",
  address: DOC_B,
});
const tabOpen = place("aaaaaaaa-0000-4000-8000-00000000000c", "SO", "303", {
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
const seeded = [ducts, tabA, tabB, tabOpen, tabOffice];
const places = () => JSON.parse(sessionStorage.getItem("pe.places") ?? "[]") as ThreadTab[];
// Only T and U are real host chats; Places are this window's sessionStorage, seeded per test.
const threads = [{ id: "T" }, { id: "U" }];
vi.mock("./provider", () => ({ useWorkbench: () => ({ store, threads }) }));
const hostEvents = vi.hoisted(() => ({ listener: null as null | ((event: unknown) => void) }));
vi.mock("#/chat/chat-shell", () => ({ ChatShell: () => <div data-chat-probe="" /> }));
vi.mock("#/route/situation-ladder", () => ({ ChatPlanIntent: createContext(null) }));
vi.mock("#/readings", () => ({
  useReading: () => ({ state: "pending" }),
  previousOf: () => undefined,
  useHostEvents: (enabled: boolean, onEvent: (event: unknown) => void) => {
    hostEvents.listener = enabled ? onEvent : null;
  },
}));
vi.mock("#/navigation/surface-host", () => ({ useSurfaceHost: () => ({ surface: "web" }) }));
const call = vi.hoisted(() => vi.fn(async (..._: unknown[]) => ({})));
vi.mock("#/host/pe-client", () => ({ peClient: { call } }));

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
  call.mockClear();
  sessionStorage.clear();
  sessionStorage.setItem("pe.places", JSON.stringify(seeded));
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

async function mount(entry = "/pea?thread=T") {
  const root = createRootRoute({
    component: () => <RouteDock renderRoute={(body) => body}>{null}</RouteDock>,
  });
  const routes = [
    createRoute({ getParentRoute: () => root, path: "/pea" }),
    createRoute({ getParentRoute: () => root, path: "/ducts", component: DuctsProbe }),
  ];
  const router = createRouter({
    routeTree: root.addChildren(routes),
    history: createMemoryHistory({ initialEntries: [entry] }),
  });
  await router.load();
  render(
    <RegistryContext.Provider value={appAtomRegistry}>
      <RouterProvider router={router} />
    </RegistryContext.Provider>,
  );
  await waitFor(() => expect(document.querySelector('[data-pane-id="tools"]')).toBeTruthy());
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
  expect(pea.querySelector('[role="group"][aria-label="Places"]')).toBeNull();
  expect(screen.getByRole("button", { name: "Expand tools" })).toBeTruthy();
  expect(tools().closest(".hidden")).toBeTruthy();
  expect(document.body.textContent).not.toMatch(/tools collapsed/i);
  expect(pea.compareDocumentPosition(tools()) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(mounts).toBe(0);
});

test("a tab press expands the tools on that Place; a Work press restores its Page without a remount", async () => {
  sessionStorage.setItem(
    "pe.places",
    JSON.stringify([
      { ...ducts, link: routeAddress("ducts").link({ system: ["S1"] } as never, { work: "w1" }) },
    ]),
  );
  const router = await mount();
  fireEvent.click(screen.getByRole("button", { name: "Expand tools" }));
  fireEvent.click(screen.getByRole("button", { name: TAB }));
  await waitFor(() => expect(router.state.location.pathname).toBe("/ducts"));
  await waitFor(() => expect(screen.getByText("S1")).toBeTruthy());
  expect(tools().closest(".hidden")).toBeNull();
  expect(tools().querySelector('[role="group"][aria-label="Places"]')).toBeTruthy();
  expect(mounts).toBe(1);

  await act(() => router.navigate({ to: "/pea", search: { thread: "T" } } as never));
  expect(tools().closest(".hidden")).toBeTruthy();
  await act(() =>
    store.actions.openWork("T", "ducts", {
      key: { binding: "workspace", route: "ducts", target: null, work: "w1" },
      url: "/ducts?work=w1",
      reason: null,
      knownOpenRefs: [],
    }),
  );
  await waitFor(() => expect(router.state.location.pathname).toBe("/ducts"));
  expect((router.state.location.search as { system?: string }).system).toBe("S1");
  // A Work press is outside the tools bar: focus lands on the tool's pane.
  expect(document.activeElement).toBe(tools());
  expect(document.querySelector("[data-chat-probe]")).toBeTruthy();
  expect(mounts).toBe(1);
});

// Host-shaped `work.resume` answers: the browser matches its own Places by the Work key.
const resume = (
  key: WorkKey,
  url = "/ducts",
  knownOpenRefs: { session: string; openId: string }[] = [],
) => ({
  key,
  url,
  reason: null,
  knownOpenRefs,
});
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
  await press(resume({ binding: "address", route: "ducts", target: DOC_B }, "/ducts?system=base"));
  await waitFor(() =>
    expect(shown(router)).toMatchObject({
      system: "SB",
      tab: "aaaaaaaa-0000-4000-8000-00000000000b",
    }),
  );
  expect(shown(router).selected).toBe("202");
  await press(resume({ binding: "address", route: "ducts", target: DOC_A }, "/ducts?system=base"));
  await waitFor(() =>
    expect(shown(router)).toMatchObject({
      system: "SA",
      tab: "aaaaaaaa-0000-4000-8000-00000000000a",
    }),
  );
  expect(shown(router).selected).toBe("101");
});

test("no Work-key match opens a new Place; Places are never guessed by route", async () => {
  const router = await mount();
  const key = {
    binding: "address",
    route: "ducts",
    target: address("C:/Jobs/Level C.rvt"),
  } as const;
  await press(resume(key, "/ducts?system=SC"));
  await waitFor(() => expect(shown(router)).toMatchObject({ path: "/ducts", system: "SC" }));
  expect(seeded.map((tab) => tab.id)).not.toContain(shown(router).tab);
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

// The producer's address key carries no `from`, so only the host's `knownOpenRefs` can say this
// open-ref Place holds the Work. The legacy Place keeps its Page and id, and its
// binding carry rebases onto the resume's stable Address so the Work stays readable once closed.
test("an address key with no `from` restores the matched open-ref Place, rebased onto the stable Address", async () => {
  const router = await mount();
  const stable = "/ducts?target=C%3A%2FJobs%2FOpen.rvt";
  await press(
    resume(
      { binding: "address", route: "ducts", target: address(String.raw`c:\jobs\open.rvt`) },
      stable,
      [{ session: "s1", openId: "o1" }],
    ),
  );
  await waitFor(() =>
    expect(shown(router)).toMatchObject({
      system: "SO",
      tab: "aaaaaaaa-0000-4000-8000-00000000000c",
    }),
  );
  expect(shown(router).selected).toBe("303");
  expect(shown(router).target).toBe("C:/Jobs/Open.rvt");
});

test("a Work pressed on a closed document shows what is kept and how to reconnect", async () => {
  // A cross-row press: the row belongs to OTHER while chat T stays selected.
  const router = await mount();
  await act(() =>
    store.actions.openWork(
      "OTHER",
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

const search = (router: Awaited<ReturnType<typeof mount>>) =>
  router.state.location.search as Record<string, string | undefined>;
const hostCalls = (name: string) => call.mock.calls.filter(([door]) => door === name);
const settle = () => act(() => new Promise((done) => setTimeout(done, 50)));

test("(a) a standalone tool URL with no ?thread mints none and calls no host door", async () => {
  sessionStorage.clear();
  const router = await mount("/ducts?target=C%3A%2FModels%2FOffice.rvt");
  await settle();
  expect(router.state.location.pathname).toBe("/ducts");
  expect(search(router).thread).toBeUndefined();
  expect(call).not.toHaveBeenCalled();
  expect(places()).toEqual([expect.objectContaining({ route: "ducts" })]);
  expect(places()[0]!.link).toContain("target=");
  // No selected real chat: no route-view-open subscription.
  expect(hostEvents.listener).toBeNull();
});

test("(b)(c) switching conversation lands on /pea collapsed, opens no tool, and leaves Places and their ?target unchanged", async () => {
  const router = await mount("/ducts?thread=T&target=C%3A%2FModels%2FOffice.rvt");
  await settle();
  const before = places();
  await act(() => router.navigate({ to: "/pea", search: { thread: "U" } } as never));
  await settle();
  expect(router.state.location.pathname).toBe("/pea");
  expect(search(router).target).toBeUndefined();
  expect(tools().closest(".hidden")).toBeTruthy();
  expect(places()).toEqual(before);
  expect(hostCalls("thread.place")).toHaveLength(0);
});

test("(d) first Send from a tool promotes in place: tool stays, one thread.place for it", async () => {
  sessionStorage.clear();
  const router = await mount("/ducts?target=C%3A%2FModels%2FOffice.rvt");
  await settle();
  const mounted = mounts;
  threads.push({ id: "NEW" });
  try {
    await act(() => store.actions.promoteThread("NEW"));
    await settle();
    expect(router.state.location.pathname).toBe("/ducts");
    expect(search(router)).toMatchObject({ thread: "NEW", target: "C:/Models/Office.rvt" });
    expect(mounts).toBe(mounted);
    store.actions.sent("NEW");
    expect(hostCalls("thread.place")).toEqual([
      [
        "thread.place",
        {
          params: { id: "NEW" },
          body: { route: "ducts", link: expect.stringContaining("/ducts") },
        },
      ],
    ]);
  } finally {
    threads.pop();
  }
});

test("(e) a Work press from another thread's row keeps the selected ?thread and records it there", async () => {
  const router = await mount("/pea?thread=T");
  await press(resume({ binding: "address", route: "ducts", target: DOC_B }, "/ducts?system=base"));
  await waitFor(() =>
    expect(shown(router)).toMatchObject({
      system: "SB",
      tab: "aaaaaaaa-0000-4000-8000-00000000000b",
    }),
  );
  expect(search(router).thread).toBe("T");
  expect(hostCalls("thread.place")).toEqual([
    ["thread.place", { params: { id: "T" }, body: { route: "ducts", link: expect.any(String) } }],
  ]);
});

test("a pasted URL for Work B activates B and never overwrites Work A's Place", async () => {
  const router = await mount(tabB.link);
  await settle();
  expect(shown(router).tab).toBe("aaaaaaaa-0000-4000-8000-00000000000b");
  expect(places().find((tab) => tab.id === "aaaaaaaa-0000-4000-8000-00000000000a")).toEqual(tabA);
});

test("route-view-open: same binding keeps the Page and tags the command; another thread is ignored", async () => {
  const router = await mount("/pea?thread=T");
  await settle();
  const commandId = "11111111-1111-4111-8111-111111111111";
  const base = routeAddress("ducts").link(undefined, {
    target: routeAddress("ducts").read(
      Object.fromEntries(new URL(tabA.link, "http://x").searchParams),
    ).carry.target,
  });
  act(() =>
    hostEvents.listener!({
      type: "route-view-open",
      route: "ducts",
      thread: "U",
      link: base,
      commandId,
    }),
  );
  await settle();
  expect(router.state.location.pathname).toBe("/pea");
  act(() =>
    hostEvents.listener!({
      type: "route-view-open",
      route: "ducts",
      thread: "T",
      link: base,
      commandId,
    }),
  );
  await waitFor(() =>
    expect(shown(router)).toMatchObject({
      tab: "aaaaaaaa-0000-4000-8000-00000000000a",
      system: "SA",
      selected: "101",
    }),
  );
  expect(
    (router.state.location.state as { __peViewOpenCommandId?: string }).__peViewOpenCommandId,
  ).toBe(commandId);
  expect(hostCalls("thread.place")).toHaveLength(1);
  // An ordinary human move clears it.
  fireEvent.click(screen.getByRole("button", { name: "Ducts · SB" }));
  await waitFor(() => expect(shown(router).tab).toBe("aaaaaaaa-0000-4000-8000-00000000000b"));
  expect(
    (router.state.location.state as { __peViewOpenCommandId?: string }).__peViewOpenCommandId,
  ).toBeUndefined();
});

test("route-view-open with a new binding opens a default Page and borrows no visible target", async () => {
  sessionStorage.setItem("pe.places", JSON.stringify([tabA]));
  const router = await mount(`${tabA.link}&thread=T`);
  await settle();
  act(() =>
    hostEvents.listener!({
      type: "route-view-open",
      route: "ducts",
      thread: "T",
      link: "/ducts",
      commandId: "22222222-2222-4222-8222-222222222222",
    }),
  );
  await waitFor(() => expect(router.state.location.pathname).toBe("/ducts"));
  expect(search(router).target).toBeUndefined();
  expect(search(router).system).toBeUndefined();
  expect(shown(router).tab).not.toBe(tabA.id);
});

test("the closed-Work band follows the Place a press opened, with no chat selected, and not another Place", async () => {
  const router = await mount("/pea");
  await act(() =>
    store.actions.openWork(
      "OTHER",
      "ducts",
      resume({ binding: "address", route: "ducts", target: DOC_A }),
      { documentId: "doc-a", document: "Level A.rvt", intent: "Size A", unfinished: 1 },
    ),
  );
  await waitFor(() => expect(document.querySelector("[data-closed-work]")).toBeTruthy());
  expect(search(router).thread).toBeUndefined();
  fireEvent.click(screen.getByRole("button", { name: "Ducts · SB" }));
  await waitFor(() => expect(shown(router).tab).toBe(tabB.id));
  expect(document.querySelector("[data-closed-work]")).toBeNull();
});
