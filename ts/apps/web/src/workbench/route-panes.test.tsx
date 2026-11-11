import { stableFanKey } from "../ducts/sheet/model";
import {route as declareRoute, scrollBody} from "../route/typed-route";
import {module as familiesDeclaration} from "../families/route";
import {workFingerprintSchema} from "@pe/agent-contracts";
import { systemCode } from "../ducts/identity";
import { namesOf } from "../route/typed-route";
import type {TypedRoute} from "../route/typed-route";
import type {RouteFingerprint} from "@pe/agent-contracts";
import { TypedShell } from "../shell/typed-shell";
// @vitest-environment jsdom
import { StrictMode, useState } from "react";
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
import { appAtomRegistry, routeSearch } from "#/shell/owner";
import { createChatPageStore } from "./store";
import { RouteDock } from "./route-panes";
import { useRouteCurrent } from "#/route/activity";
import { admittedRouterAddress } from "#/shell/typed-place-boundary";
import { searchCodec } from "#/route/address-transport";
import { SHOWN, urlSettled } from "#/test-journey";
import { useRestoreTabPage } from "#/route/url";

const store = createChatPageStore({
  registry: appAtomRegistry,
  search: { patch: async () => {} },
});
const ducts: ThreadTab = {
  id: "aaaaaaaa-0000-4000-8000-000000000001",
  route: "ducts",
  link: routeAddress("ducts").link({ system: {kind:"ids",ids:[systemCode("S1")]} }),
  at: "2026-10-24T00:00:00.000Z",
};
const TAB = routeAddress("ducts").title;
// Three Places on the one tool, each on its own document and its own non-default Page.
const DOC_A = address("C:/Jobs/Level A.rvt"),
  DOC_B = address("C:/Jobs/Level B.rvt");
const place = (id: string, system: string, selected: string, target: unknown): ThreadTab => ({
  id,
  route: "ducts",
  link: routeAddress("ducts").link({ system: {kind:"ids",ids:[systemCode(system)]}, selected: [{kind:"focus",id:selected}] } as never, {
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
const seeded = [ducts, tabA, tabB, tabOpen];
const places = () => JSON.parse(sessionStorage.getItem("pe.places") ?? "[]") as ThreadTab[];
// Only T and U are real host chats; Places are this window's sessionStorage, seeded per test.
const threads = [{ id: "T" }, { id: "U" }];
vi.mock("./provider", () => ({ useWorkbench: () => ({ store, threads }) }));
const hostEvents = vi.hoisted(() => {
  const listeners = new Set<(event: unknown) => void>();
  return { listeners, emit: (event: unknown) => [...listeners].forEach((each) => each(event)) };
});
vi.mock("#/chat/chat-shell", () => ({ ChatShell: () => <div data-chat-probe="" /> }));
vi.mock("#/route/situation-ladder", async () => ({ ChatPlanIntent: (await import("react")).createContext(null) }));
vi.mock("#/host/resource-stream", async (actual) => {
  const { useEffect } = await import("react");
  const real = await actual<typeof import("#/host/resource-stream")>();
  // Readings are quiet here: no stream subscription leaves the test.
  real.peReadings.subscribe = () => () => {};
  return {
    ...real,
    useHostEvents: (enabled: boolean, onEvent: (event: unknown) => void) =>
      useEffect(() => {
        if (!enabled) return;
        hostEvents.listeners.add(onEvent);
        return () => void hostEvents.listeners.delete(onEvent);
      }, [enabled, onEvent]),
  };
});
vi.mock("#/host/resource-state", async (actual) => ({
  ...(await actual<typeof import("#/host/resource-state")>()),
  useReading: () => ({ state: "pending" }),
  previousOf: () => undefined,
}));
vi.mock("#/navigation/surface-host", () => ({ useSurfaceHost: () => ({ surface: "web" }) }));
const call = vi.hoisted(() =>
  vi.fn(async (door: unknown, ..._: unknown[]) => (door === "view.publish" ? { revision: 1 } : {})),
);
vi.mock("#/host/pe-client", () => ({ peClient: { call } }));

// The retention/lease witness uses the typed Page contract without acquiring native evidence or Work.
const familiesProbe=declareRoute({
  ...familiesDeclaration.spec, needs:"browser",core:undefined,edits:undefined,commands:{},
  panes:{probe:{title:"Probe",purpose:"Retention proof",body:"scroll",draw:ctx=>scrollBody(<output data-families-probe="">{ctx.page.read().focus}</output>)}},
  layout:{kind:"pane",id:"probe"},
});
function FamiliesProbe() {
  return <TypedShell module={familiesProbe} fingerprint={workFingerprintSchema.parse(`builtin-closure:${"0".repeat(64)}`)} />;
}

let mounts = 0;
let bodyCurrent: (() => boolean) | null = null;
function DuctsProbe() {
  useState(() => ++mounts);
  bodyCurrent = useRouteCurrent();
  const system = useRouterState({
    select: (state) => routeAddress("ducts").read(state.location.search).page.system,
  });
  return <output data-ducts-probe="">{system.kind === "all" ? "all" : (namesOf(system) as string[]).join(" + ")}</output>;
}

beforeEach(() => {
  mounts = 0;
  call.mockReset();
  call.mockImplementation(async (door) => (door === "view.publish" ? { revision: 1 } : {}));
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

let fansRoute: {typed:TypedRoute;workFingerprint:RouteFingerprint} | null = null;
function FansProbe() {
  const route = fansRoute;
  if (!route) throw Error("Fans must be admitted before the router mounts");
  return <TypedShell module={route.typed} fingerprint={route.workFingerprint} />;
}
let podRoute: { module: TypedRoute; fingerprint: RouteFingerprint } | null = null;
/** The normal `/tool/<key>` mount: the registered Pod's own owner and codecs, as `tool.$key` mounts it. */
function PodProbe() {
  return <TypedShell module={podRoute!.module} fingerprint={podRoute!.fingerprint} />;
}
function Restore() {
  useRestoreTabPage();
  return null;
}
async function mount(entry = "/pea?thread=T", strict = false, restore = false, validate = false) {
  if (entry.startsWith("/fans")) {
    const { admit } = await import("../fans/admission.fixture");
    fansRoute = (await admit()).presenter;
  }
  const root = createRootRoute({
    // The app root's search reader (routes/__root.tsx), so router-built hrefs match the app's.
    ...(validate ? { validateSearch: routeSearch } : {}),
    component: () => (
      <>
        {restore && <Restore />}
        <RouteDock renderRoute={(body) => body}>{null}</RouteDock>
      </>
    ),
  });
  const routes = [
    createRoute({ getParentRoute: () => root, path: "/pea" }),
    createRoute({ getParentRoute: () => root, path: "/ducts", component: DuctsProbe }),
    createRoute({ getParentRoute: () => root, path: "/families", component: FamiliesProbe }),
    createRoute({ getParentRoute: () => root, path: "/fans", component: FansProbe }),
    createRoute({ getParentRoute: () => root, path: "/tool/$key", component: PodProbe }),
  ];
  const router = createRouter({
    routeTree: root.addChildren(routes),
    history: createMemoryHistory({ initialEntries: [entry] }),
    ...(validate ? searchCodec : {}),
  });
  await router.load();
  const tree = (
    <RegistryContext.Provider value={appAtomRegistry}>
      <RouterProvider router={router} />
    </RegistryContext.Provider>
  );
  render(strict ? <StrictMode>{tree}</StrictMode> : tree);
  await waitFor(() => expect(document.querySelector('[data-pane-id="tools"]')).toBeTruthy());
  return router;
}
const tools = () => document.querySelector<HTMLElement>('[data-pane-id="tools"]')!;

test("a tab press expands the tools on that Place; a Work press restores its Page without a remount", async () => {
  sessionStorage.setItem(
    "pe.places",
    JSON.stringify([
      { ...ducts, link: routeAddress("ducts").link({ system: {kind:"ids",ids:[systemCode("S1")]} }, { work: "w1" }) },
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
  expect(shown(router).system).toBe("S1");
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
  system: (()=>{const subject=routeAddress("ducts").read(router.state.location.search).page.system; return subject.kind === "all" ? "all" : (namesOf(subject) as string[]).join(" + ");})(),
  selected: routeAddress("ducts").read(router.state.location.search).page.selected.map(item=>item.id).join(","),
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
  await press(resume(key, routeAddress("ducts").link({system:{kind:"ids",ids:[systemCode("SC")]}})));
  await waitFor(() => expect(shown(router)).toMatchObject({ path: "/ducts", system: "SC" }));
  expect(seeded.map((tab) => tab.id)).not.toContain(shown(router).tab);
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

const search = (router: Awaited<ReturnType<typeof mount>>) =>
  router.state.location.search as Record<string, string | undefined>;
const hostCalls = (name: string) => call.mock.calls.filter(([door]) => door === name);
const settle = () => act(() => new Promise((done) => setTimeout(done, 50)));

test("an actual admitted standalone Fans Place enrolls without a chat or native host call", async () => {
  sessionStorage.clear();
  // JSON string codec text (plain, empty, numeric-looking) survives the history tag's state write.
  const strings = {
    stage: JSON.stringify("sheet"),
    contextStyle: JSON.stringify("glass"),
    inputSort: JSON.stringify(""),
    sheetPath: JSON.stringify("8081605"),
  };
  const router = await mount(
    `/fans?fixture=layout&contextRadiusFt=15&${new URLSearchParams(strings)}`,
    true,
  );
  const body = document.querySelector<HTMLElement>("[data-route-tab]")!;
  await waitFor(() => expect(shown(router).tab).not.toBeNull());
  expect(document.querySelector("[data-route-tab]")).toBe(body);
  expect(body.dataset.routeTab).toBe(shown(router).tab);
  expect(router.state.location.pathname).toBe("/fans");
  expect(search(router).thread).toBeUndefined();
  expect(call).not.toHaveBeenCalled();
  expect(places()).toEqual([expect.objectContaining({ route: "fans" })]);
  expect(places()[0]!.link).toContain("fixture=layout");
  // New enrollment must preserve the actual admitted object codec, never the old comma list.
  expect(
    JSON.parse(new URL(places()[0]!.link, "http://place.invalid").searchParams.get("fan")!),
  ).toEqual({ kind: "ids", ids: [] });
  const kept = (href: string) =>
    Object.fromEntries(
      Object.keys(strings).map((key) => [
        key,
        new URL(href, "http://place.invalid").searchParams.get(key),
      ]),
    );
  expect((router.history.location.state as { __peRouteTab?: unknown }).__peRouteTab).toBeTruthy();
  expect(kept(router.history.location.href)).toEqual(strings);
  expect(kept(places()[0]!.link)).toEqual(strings);
  expect(hostEvents.listeners.size).toBe(0);
  const placeId = places()[0]!.id;
  await act(() => router.navigate({ to: "/pea", search: { thread: "T" } } as never));
  fireEvent.click(screen.getByRole("button", { name: "Expand tools" }));
  fireEvent.click(screen.getByRole("button", { name: "Fans" }));
  await waitFor(() => expect(router.state.location.pathname).toBe("/fans"));
  expect(router.state.location.search).toMatchObject({ thread: "T", contextRadiusFt: 15 });
  expect(
    new URL(router.history.location.href, "http://place.invalid").searchParams.get(
      "contextRadiusFt",
    ),
  ).toBe("15");
  expect(shown(router).tab).toBe(placeId);
  expect(kept(router.history.location.href)).toEqual(strings);
});

test("an admitted Place keeps its codec bytes through open, switch, bare URL restore, Back and reload", async () => {
  // Object, list, numeric, numeric-looking string, empty string, plain string and literal-percent
  // values: each one the legacy codec or TanStack's parse/stringify re-encoded (`%257B`, `"{..}"`)
  // or unquoted (`"glass"` -> `glass`) before the admitted owner could read it.
  const fan = JSON.stringify({ kind: "ids", ids: [stableFanKey({ uniqueId: "MUAS-1 50%", portIndex: 2 }), stableFanKey({ uniqueId: "8081605-uid", portIndex: 0 })] });
  const rosterSearch = JSON.stringify({ keywords: "100%25 off", pills: [], v: 1 });
  const page = {
    fixture: "layout",
    fan,
    rosterSearch,
    contextRadiusFt: "15",
    stage: JSON.stringify("sheet"),
    contextStyle: JSON.stringify("glass"),
    inputSort: JSON.stringify(""),
    sheetPath: JSON.stringify("8081605"),
  };
  const link = `/fans?${new URLSearchParams(page)}`;
  const fans: ThreadTab = {
    id: "aaaaaaaa-0000-4000-8000-0000000000f0",
    route: "fans",
    link,
    at: ducts.at,
  };
  sessionStorage.setItem("pe.places", JSON.stringify([ducts, fans]));
  // Raw `key=value` pairs, never decoded: byte equality, order-free, the shell's own keys aside.
  const pairs = (query: string) =>
    query
      .replace(/^\?/, "")
      .split("&")
      .filter((pair) => pair && !/^(thread|shell)=/.test(pair))
      .sort();
  let router = await mount("/fans?fixture=layout", false, true);
  const held = async () => {
    await waitFor(() => expect(router.state.location.pathname).toBe("/fans"));
    await settle();
    const raw = new URL(router.history.location.href, "http://place.invalid").searchParams;
    expect(Object.fromEntries(Object.keys(page).map((key) => [key, raw.get(key)]))).toEqual(page);
    expect(pairs(router.history.location.search)).toEqual(
      pairs(new URL(link, "http://p.invalid").search),
    );
    expect(places().find((tab) => tab.route === "fans")!.link).toBe(link);
    expect(document.body.textContent).not.toMatch(/malformed/i);
  };
  // A bare URL with no history tag restores the Place from memory; its history tag keeps the bytes.
  await held();
  // Reusing the existing Place (the app's tool entry) keeps its bytes; no legacy re-canonicalization.
  await act(() => router.navigate({ to: "/pea", search: { thread: "T" } } as never));
  await act(() => store.actions.openTab("fans"));
  await held();
  // Tab switch away and back, then Back and Forward through history.
  fireEvent.click(screen.getByRole("button", { name: TAB }));
  await waitFor(() => expect(router.state.location.pathname).toBe("/ducts"));
  fireEvent.click(screen.getByRole("button", { name: "Fans" }));
  await held();
  await act(() => router.history.back());
  await waitFor(() => expect(router.state.location.pathname).toBe("/ducts"));
  await act(() => router.history.forward());
  await held();
  // Reload: a fresh router mounts on the same address and must not canonicalize its bytes.
  const href = router.history.location.href;
  cleanup();
  router = await mount(href, false, true);
  await held();
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
  const placeId = shown(router).tab;
  threads.push({ id: "NEW" });
  try {
    await act(() => store.actions.promoteThread("NEW"));
    await settle();
    expect(router.state.location.pathname).toBe("/ducts");
    expect(search(router)).toMatchObject({ thread: "NEW", target: "C:/Models/Office.rvt" });
    expect(mounts).toBe(mounted);
    expect(shown(router).tab).toBe(placeId);
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
    hostEvents.emit({
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
    hostEvents.emit({
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
  fireEvent.click(
    screen.getAllByRole("button", { name: TAB })[places().findIndex((tab) => tab.id === tabB.id)]!,
  );
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
    hostEvents.emit({
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
  fireEvent.click(
    screen.getAllByRole("button", { name: TAB })[places().findIndex((tab) => tab.id === tabB.id)]!,
  );
  await waitFor(() => expect(shown(router).tab).toBe(tabB.id));
  expect(document.querySelector("[data-closed-work]")).toBeNull();
});

test("an explicit open's command id clears when the thread association changes", async () => {
  sessionStorage.setItem("pe.places", JSON.stringify([]));
  const router = await mount("/pea?thread=T");
  await settle();
  const commandId = "33333333-3333-4333-8333-333333333333";
  act(() =>
    hostEvents.emit({
      type: "route-view-open",
      route: "ducts",
      thread: "T",
      link: "/ducts",
      commandId,
    }),
  );
  const command = () =>
    (router.state.location.state as { __peViewOpenCommandId?: string }).__peViewOpenCommandId;
  await waitFor(() => expect(command()).toBe(commandId));
  await act(() =>
    router.navigate({
      to: "/ducts",
      search: { ...search(router), thread: "U" },
      state: router.state.location.state,
      replace: true,
    } as never),
  );
  await waitFor(() => expect(command()).toBeUndefined());
  expect(router.state.location.pathname).toBe("/ducts");
});

test("a saved legacy open-ref Place keeps its id under StrictMode, /pea and a cross-row Work press", async () => {
  sessionStorage.clear();
  // The bytes a writer saves (host navigation.ts resume link); a restore matches saved bytes exactly.
  const legacy = routeAddress("ducts").link({ system: {kind:"ids",ids:[systemCode("Office retained page")]} }, {
    target: JSON.stringify({ kind: "open", ref: { session: "closed-session", openId: "closed-open" } }),
  });
  // New enrollment is exercised above through actual Fans admission. This tests saved-Place rebinding.
  sessionStorage.setItem("pe.places", JSON.stringify([{ ...ducts, link: legacy }]));
  const router = await mount(legacy, true);
  await waitFor(() => expect(shown(router).tab).not.toBeNull());
  await settle();
  const id = shown(router).tab;
  expect(places()).toHaveLength(1);
  expect(places()[0]!.id).toBe(id);
  await act(() => router.navigate({ to: "/pea", search: { thread: "U" } } as never));
  await settle();
  await act(() =>
    store.actions.openWork(
      "OTHER",
      "ducts",
      resume(
        { binding: "address", route: "ducts", target: address("C:/Models/Office.rvt") },
        `/ducts?target=${encodeURIComponent("C:/Models/Office.rvt")}`,
        [{ session: "closed-session", openId: "closed-open" }],
      ),
    ),
  );
  await waitFor(() => expect(shown(router).path).toBe("/ducts"));
  await settle();
  expect(shown(router)).toMatchObject({ tab: id, system: "Office retained page" });
  expect(search(router).thread).toBe("U");
  expect(places()).toHaveLength(1);
});

test("after a cross-row Work press the retained body is current again under the {id, route} tag", async () => {
  const router = await mount(tabB.link);
  await waitFor(() => expect(shown(router).tab).toBe(tabB.id));
  await act(() => router.navigate({ to: "/pea", search: { thread: "U" } } as never));
  await settle();
  expect(bodyCurrent!()).toBe(false);
  await press(resume({ binding: "address", route: "ducts", target: DOC_B }, "/ducts?system=base"));
  await waitFor(() => expect(shown(router)).toMatchObject({ tab: tabB.id, system: "SB" }));
  expect(mounts).toBe(1);
  expect(bodyCurrent!()).toBe(true);
});

test("a Pea open of a new tool keeps its first lease instance, and a set against it is acknowledged", async () => {
  let finishPublish: ((value: { revision: number }) => void) | undefined;
  call.mockImplementation(async (door) => {
    if (door === "view.publish" && !finishPublish)
      return await new Promise<{ revision: number }>((resolve) => {
        finishPublish = resolve;
      });
    return door === "view.publish" ? { revision: 1 } : {};
  });
  const router = await mount("/pea?thread=T", true);
  await settle();
  act(() =>
    hostEvents.emit({
      type: "route-view-open",
      route: "families",
      thread: "T",
      link: "/families",
      commandId: "44444444-4444-4444-8444-444444444444",
    }),
  );
  await waitFor(() => expect(router.state.location.pathname).toBe("/families"));
  await waitFor(() => expect(hostCalls("view.publish").length).toBeGreaterThan(0));
  await settle();
  const leases = () =>
    new Set(
      hostCalls("view.publish").map(
        ([, input]) => (input as { body: { instance: string } }).body.instance,
      ),
    );
  const [instance] = [...leases()];
  act(() =>
    hostEvents.emit({
      type: "route-view-intent",
      route: "families",
      thread: "T",
      instance,
      commandId: "55555555-5555-4555-8555-555555555555",
      revision: 1,
      patch: {
        focus: routeAddress("families").agent.write({focus:'name:["Family","Type"]#field:Name'}).focus!,
      },
    }),
  );
  expect(hostCalls("view.ack")).toEqual([]);
  await act(async () => finishPublish!({ revision: 1 }));
  await waitFor(() => expect(hostCalls("view.ack").length).toBe(1));
  await settle();
  expect((hostCalls("view.ack")[0]![1] as { body: unknown }).body).not.toHaveProperty("refusal");
  expect(hostCalls("view.remove")).toEqual([]);
  expect(leases()).toEqual(new Set([instance]));
  expect(places().some((tab) => tab.route === "families")).toBe(true);
});

test("after first-Send promotion and a chat pick, a Pea open keeps one lease and one Place", async () => {
  sessionStorage.clear();
  const router = await mount("/ducts?target=C%3A%2FModels%2FOffice.rvt");
  await settle();
  threads.push({ id: "NEW" });
  try {
    await act(() => store.actions.promoteThread("NEW"));
    await settle();
    await act(() => router.navigate({ to: "/pea", search: { thread: "NEW" } } as never));
    await settle();
    act(() =>
      hostEvents.emit({
        type: "route-view-open",
        route: "families",
        thread: "NEW",
        link: "/families",
        commandId: "66666666-6666-4666-8666-666666666666",
      }),
    );
    await waitFor(() => expect(router.state.location.pathname).toBe("/families"));
    await waitFor(() => expect(hostCalls("view.publish").length).toBeGreaterThan(0));
    await settle();
    await settle();
    expect(hostCalls("view.remove")).toEqual([]);
    expect(places().filter((tab) => tab.route === "families")).toHaveLength(1);
    expect(
      screen.getAllByRole("button", { name: "Families" }).length,
    ).toBeGreaterThan(0);
  } finally {
    threads.pop();
  }
});

test("a route picture link leaves the conversation pane open", async () => {
  await mount("/ducts?system=S1&picture=model");
  await waitFor(() => expect(tools().closest(".hidden")).toBeNull());
  expect(screen.queryByRole("button", { name: "Expand tools" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Expand pea" })).toBeNull();
  expect(bodyCurrent?.()).toBe(true);
});

test("subject availability does not fold an expanded Pea pane in the same Place", async () => {
  const { observeSubject } = await import("#/shell/subject");
  await mount("/fans?picture=%22model%22&fixture=layout");
  await settle();
  expect(screen.queryByRole("button", { name: "Expand pea" })).toBeNull();
  let withdraw = () => {};
  try {
    act(() => {
      withdraw = observeSubject("fans", {
        current: () => true,
        read: () => ({ ready: false, refusal: "Subject is rereading", label: "", link: null }),
        subscribe: () => () => {},
      });
    });
    await settle();
    expect(screen.queryByRole("button", { name: "Expand pea" })).toBeNull();
  } finally {
    act(() => withdraw());
  }
  expect(screen.queryByRole("button", { name: "Expand pea" })).toBeNull();
});

test("a delivered route-view-open for a trusted Pod creates its Place at the registered /tool address", async () => {
  const { readFile } = await import("node:fs/promises");
  const { resolve } = await import("node:path");
  const { podRouteDescriptorSchema } = await import("@pe/agent-contracts");
  const { loadPodRoute } = await import("#/route/pod-module");
  const { registerTypedRoute } = await import("#/shell/route-registration");
  const pods = resolve(process.cwd(), "../../../examples/pods/snowdon-circuits");
  const member = JSON.parse(await readFile(resolve(pods, "pod.json"), "utf8")).routes[0];
  const row = podRouteDescriptorSchema.parse({
    ...member,
    key: `route:@snowdon-circuits/${member.artifact}`,
    packageId: "snowdon-circuits",
    workRoute: "pod.snowdon-circuits.voltage-drop",
    trusted: true,
  });
  const artifact = JSON.parse(await readFile(resolve(pods, row.artifact), "utf8"));
  podRoute = await loadPodRoute(
    row,
    { fingerprint: row.fingerprint, artifact },
    (bytes) =>
      import(
        /* @vite-ignore */ `data:text/javascript;base64,${Buffer.from(bytes).toString("base64")}`
      ),
  );
  const withdraw = registerTypedRoute(podRoute.module, podRoute.fingerprint);
  try {
    expect(podRoute.module.data.address.startsWith("/tool/")).toBe(true);
    const router = await mount("/fans?thread=T&fixture=layout");
    await settle();
    const commandId = "22222222-2222-4222-8222-222222222222";
    const query = new URLSearchParams({
      selected: "[]",
      target: 'C:/Jobs/100%25 "glass".rvt',
      work: "worksheet%25",
    });
    const link = `${podRoute.module.data.address}?${query}`;
    const deliver = (route = podRoute!.module.data.key, url = link) =>
      act(() =>
        hostEvents.emit({
          type: "route-view-open",
          route,
          thread: "T",
          link: url,
          commandId,
        }),
      );
    deliver("unknown.pod", "/tool/unknown");
    expect(router.state.location.pathname).toBe("/fans");
    deliver();
    await waitFor(() => expect(router.state.location.pathname).toBe(podRoute!.module.data.address));
    expect(
      (router.state.location.state as { __peViewOpenCommandId?: string }).__peViewOpenCommandId,
    ).toBe(commandId);
    expect(hostCalls("thread.place")).toHaveLength(1);
    expect(hostCalls("thread.place")[0]![1]).toMatchObject({ body: { route: podRoute.module.data.key } });
    const saved = places().find((tab) => tab.route === podRoute!.module.data.key)!;
    expect(saved.link).toBe(link);
    expect(screen.getByRole("button", { name: /^Circuit voltage drop/ })).toBeTruthy();
    expect(
      new URL(router.history.location.href, "http://place.invalid").searchParams.get("target"),
    ).toBe(query.get("target"));
    // This artifact declares no agent field, so the host leases it no view (`viewRoute`: a registered
    // route leases only with agent fields) and refuses its PUT; the browser publishes none (slice 6.1b).
    expect(hostCalls("view.publish").filter(([, input]) => (input as { params: { route: string } }).params.route === podRoute!.module.data.key)).toEqual([]);
    await act(() => router.navigate({ to: "/fans", search: { thread: "T", fixture: "layout" } } as never));
    const priorFans = router.history.location.href;
    deliver();
    await settle();
    expect(
      places()
        .filter((tab) => tab.route === podRoute!.module.data.key)
        .map((tab) => tab.id),
    ).toEqual([saved.id]);
    await act(() => router.history.back());
    await waitFor(() => expect(router.history.location.href).toBe(priorFans));
    await settle();
    deliver();
    await waitFor(() => expect(router.state.location.pathname).toBe(podRoute!.module.data.address));
    fireEvent.click(await screen.findByRole("button", { name: "Open another Place on this route" }));
    await waitFor(() => expect(places().filter((tab) => tab.route === podRoute!.module.data.key)).toHaveLength(2));
    expect(places().filter((tab) => tab.route === podRoute!.module.data.key).map((tab) => tab.link)).toEqual([link, link]);
    await act(() => router.history.back());
    await settle();
    const before = places();
    await act(async () => withdraw());
    const calls = call.mock.calls.length;
    deliver();
    await settle();
    expect(call.mock.calls).toHaveLength(calls);
    expect(places()).toEqual(before);
  } finally {
    withdraw();
    podRoute = null;
  }
}, 30_000);

test("fan selection with picture pose preserves Pea open state and width", async () => {
  const router = await mount("/fans?fixture=layout");
  await settle();
  const dock = () =>
    [...document.querySelectorAll<HTMLElement>("[data-layout-split]")].find(
      (el) => el.dataset.layoutSplit === JSON.stringify(["route-dock", "tools"]),
    )!;
  const size = dock().style.getPropertyValue("--pane-size");
  await act(() => router.navigate({
    to: "/fans",
    search: { fixture: "layout", fan: JSON.stringify({kind:"all"}), picture: JSON.stringify("model") },
  } as never));
  await settle();
  expect(screen.queryByRole("button", { name: "Expand pea" })).toBeNull();
  expect(dock().style.getPropertyValue("--pane-size")).toBe(size);
});

test("N-03 typed Fans retains a newly explicit pin when its resolved target is unchanged", async () => {
  sessionStorage.clear();
  const router = await mount("/fans?fixture=layout");
  await waitFor(() => expect(places().some((tab) => tab.route === "fans")).toBe(true));
  const pin = JSON.stringify({ kind: "open", ref: { session: "same", openId: "same" } });
  await act(async () => {
    const port = admittedRouterAddress(router.history),
      query = port.read();
    query.set("target", pin);
    port.write(query, "push");
  });
  await settle();
  expect(
    new URL(
      places().find((tab) => tab.route === "fans")!.link,
      "http://place.invalid",
    ).searchParams.get("target"),
  ).toBe(pin);
  await act(() => router.navigate({ to: "/$route", params: { route: "pea" } }));
  fireEvent.click(screen.getByRole("button", { name: "Expand tools" }));
  fireEvent.click(screen.getByRole("button", { name: "Fans" }));
  await waitFor(() => expect(router.state.location.pathname).toBe("/fans"));
  expect(
    new URL(router.history.location.href, "http://place.invalid").searchParams.get("target"),
  ).toBe(pin);
});

test("6.1 a reopened Place keeps an exact ?target, and its URL mark witnesses it", async () => {
  sessionStorage.clear();
  const pin = JSON.stringify({ kind: "open", ref: { session: "s1", openId: "o1" } });
  // The app root's search reader and the app router's codec (router.tsx).
  const router = await mount(`/fans?fixture=layout&target=${encodeURIComponent(pin)}`, false, false, true);
  await waitFor(() => expect(places().filter((tab) => tab.route === "fans")).toHaveLength(1));
  fireEvent.click(await screen.findByRole("button", { name: "Open another Place on this route" }));
  await waitFor(() => expect(places().filter((tab) => tab.route === "fans")).toHaveLength(2));
  fireEvent.click(screen.getAllByRole("button", { name: /^Close / })[0]!);
  await waitFor(() => expect(places().filter((tab) => tab.route === "fans")).toHaveLength(1));
  await urlSettled();
  expect(new URLSearchParams(router.history.location.search).get("target")).toBe(pin);
  expect(places().map((tab) => new URL(tab.link, "http://tab.invalid").searchParams.get("target"))).toEqual([pin]);
});

test("6.1 the URL mark appears only after the Place's URL write", async () => {
  sessionStorage.clear();
  let search = new URLSearchParams(), held: URLSearchParams | null = null;
  const listeners = new Set<() => void>();
  const port = { read: () => new URLSearchParams(search), write: (next: URLSearchParams) => { held = new URLSearchParams(next); },
    subscribe: (listener: () => void) => { listeners.add(listener); return () => void listeners.delete(listener); } };
  const flush = () => { search = held!; held = null; listeners.forEach((listener) => listener()); };
  let pose: ((patch: { readId: string }) => unknown) | null = null;
  const probe = declareRoute({ ...familiesProbe.spec, panes: { probe: { title: "Probe", purpose: "URL flush", body: "scroll",
    draw: (ctx) => { pose = ctx.page.pose; return scrollBody(<output>{ctx.page.read().readId}</output>); } } } });
  const root = createRootRoute({ component: () => <TypedShell module={probe} fingerprint={workFingerprintSchema.parse(`builtin-closure:${"0".repeat(64)}`)} address={port} /> });
  const router = createRouter({ routeTree: root, history: createMemoryHistory({ initialEntries: ["/"] }) });
  await router.load();
  render(<RegistryContext.Provider value={appAtomRegistry}><RouterProvider router={router} /></RegistryContext.Provider>);
  await urlSettled();
  act(() => void pose!({ readId: "r2" }));
  expect(held).not.toBeNull();
  expect(document.querySelector("[data-url-settled]")).toBeNull();
  act(flush);
  expect((await urlSettled()).textContent).toContain("r2");
});

test("6.1 two Places, one hidden: the shown copy is the only one that answers its name", async () => {
  sessionStorage.clear();
  await mount("/fans?fixture=layout");
  await waitFor(() => expect(places().filter((tab) => tab.route === "fans")).toHaveLength(1), { timeout: 10_000 });
  fireEvent.click(await screen.findByRole("button", { name: "Open another Place on this route" }));
  await waitFor(() => expect(places().filter((tab) => tab.route === "fans")).toHaveLength(2), { timeout: 10_000 });
  // Count Place copies by the kernel pane's identity: a body may reuse the name (the roster's own
  // list section is "fans", which a CSS attribute match in jsdom takes for "Fans").
  const roster = '[data-slot="pane"][data-pane-id="sheet-roster"]';
  await waitFor(() => expect(document.querySelectorAll(roster)).toHaveLength(2), { timeout: 10_000 });
  expect(screen.getAllByRole("region", { name: "Fans" })).toHaveLength(1);
  expect(document.querySelectorAll(`${roster}${SHOWN}`)).toHaveLength(1);
});

test("6.1b first open of /fans while the document bind is pending reads as pending, never as unavailable", async () => {
  sessionStorage.clear();
  let drew = false;
  const watch = new MutationObserver(() => { drew ||= document.body.textContent?.includes("Document unavailable") ?? false; });
  watch.observe(document.body, { subtree: true, childList: true, characterData: true });
  try {
    // The inventory Reading is mocked pending (`useReading`), so the bind never answers here.
    await mount("/fans");
    await settle();
    expect(drew).toBe(false);
    await screen.findByText("Finding the open document");
    expect(document.querySelector('[aria-busy="true"]:has(> [data-kind="busy"])')).not.toBeNull();
  } finally { watch.disconnect(); }
});
