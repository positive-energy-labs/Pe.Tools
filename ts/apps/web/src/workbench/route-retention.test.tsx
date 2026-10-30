// @vitest-environment jsdom
import { Activity, StrictMode, useEffect, useRef, useState } from "react";
import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vite-plus/test";
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
  RouterContextProvider,
  useRouterState,
} from "@tanstack/react-router";
import {
  ductsRouteState,
  readingKey,
  routeAddress,
  workWriteSchema,
  type ThreadTab,
} from "@pe/agent-contracts";
import { z } from "zod";
import { peClient } from "#/host/pe-client";
import { peReadings } from "#/readings";
import { useRouteSearch, useRouteDemo, useRouteNavigate } from "#/route/activity";
import { defineRoute } from "#/route/manifest";
import { appAtomRegistry, routeSearch, useRouteOwner } from "#/route/route-owner";
import { useRoute } from "#/route/use-route";
import { urlPage } from "#/route/url";
import { applyPageIntent } from "#/route/view-owner";
import { useRouteLease } from "#/route/view-bridge";
import { RouteRetention } from "./route-retention";
import * as routeHost from "#/route/host";

const native = vi.fn<(...args: any[]) => Promise<null>>(async () => null);
const poseA = routeAddress("ducts").read({ viewport: "orbit:45,30,1.25@0,0,0" }).page.viewport;
const poseB = routeAddress("ducts").read({ viewport: "orbit:90,20,2@1,2,3" }).page.viewport;
const manifest = defineRoute({
  key: "ducts",
  name: "Ducts",
  address: "ducts",
  page: routeAddress("ducts").schema,
  work: ductsRouteState,
  actions: {
    native: {
      label: "native",
      says: "native",
      needs: "host",
      input: z.void() as unknown as z.ZodType<never>,
      dirties: [],
      ready: () => null,
      run: native,
    },
  },
});
const otherManifest = defineRoute({
  key: "families",
  name: "Families",
  address: "families",
  page: routeAddress("families").schema,
});
const url = urlPage(manifest)!;
const useDuct = (work?: string) => useRoute(manifest, { work });
type Probe = {
  handle: ReturnType<typeof useDuct>;
  instance: string;
  search: Record<string, unknown>;
  demo: string | null;
  navigate: ReturnType<typeof useRouteNavigate>;
  disposed: ReturnType<typeof vi.fn>;
};
const probes = new Map<string, Probe>();

test("retaining the tools index selects its leaf rather than the root with the same full path", async () => {
  const root = createRootRoute({ component: () => <output>root shell</output> });
  const index = createRoute({
    getParentRoute: () => root,
    path: "/",
    component: () => <output>tools index</output>,
  });
  const router = createRouter({
    routeTree: root.addChildren([index]),
    history: createMemoryHistory({ initialEntries: ["/"] }),
  });
  await router.load();
  const view = render(
    <RouterContextProvider router={router}>
      <RouteRetention
        route="home"
        active={null}
        tabs={[]}
        ready={false}
        renderRoute={(body) => body}
      />
    </RouterContextProvider>,
  );
  expect(view.getByText("tools index")).toBeTruthy();
  expect(view.queryByText("root shell")).toBeNull();
});
const running = new Set<string>();
const frames = new Set<Parameters<typeof peReadings.subscribe>[1]>();
const subscriptions: { kind: string; release: ReturnType<typeof vi.fn> }[] = [];
const wire: { operation: string; input: any }[] = [];
let revision = 0;

function DuctProbe() {
  const search = useRouteSearch();
  const id = useRef(String(search.target ?? "A")).current;
  const [instance] = useState(() => crypto.randomUUID());
  const [draft, setDraft] = useState("");
  const handle = useDuct(String(search.target ?? "A"));
  const [page, setPage] = handle.page;
  const demo = useRouteDemo();
  const navigate = useRouteNavigate();
  const owner = useRouteOwner(() => ({ registry: appAtomRegistry, dispose: vi.fn() }));
  probes.set(id, { handle, instance, search, demo, navigate, disposed: owner.dispose });
  useEffect(() => {
    running.add(id);
    const key = (event: KeyboardEvent) => {
      if (event.key === "F8") void handle.actions.native.run();
    };
    window.addEventListener("keydown", key);
    return () => {
      running.delete(id);
      window.removeEventListener("keydown", key);
    };
  }, [id, handle.actions.native]);
  useRouteLease("ducts", handle.page, {
    context: { target: search.target },
    facts: { selected: page.selected },
  });
  return (
    <div data-probe={id}>
      <output>
        {page.selected}|{JSON.stringify(page.viewport)}|{search.thread}|{search.target}|{demo}
      </output>
      <input
        aria-label={`draft ${id}`}
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
      />
      <button onClick={() => setPage({ selected: `${id}-selected`, viewport: poseA })}>
        select {id}
      </button>
    </div>
  );
}
function OtherProbe() {
  const handle = useRoute(otherManifest);
  return <div data-probe="families">Families {handle.page[0].query}</div>;
}

const tab = (id: string, route: "ducts" | "families" = "ducts"): ThreadTab => ({
  id,
  route,
  link: `/${route}?target=${id}`,
  at: "2026-10-22T00:00:00.000Z",
});

async function mount({
  enrolled = true,
  strict = false,
  many = false,
}: { enrolled?: boolean; strict?: boolean; many?: boolean } = {}) {
  let tabs = many
    ? [tab("A"), ...Array.from({ length: 11 }, (_, index) => tab(`T${index}`))]
    : [tab("A"), tab("B"), tab("C", "families")];
  let ready = enrolled;
  let folded = false;
  let force: () => void = () => {};
  function Root() {
    const location = useRouterState({ select: (state) => state.location });
    const [, bump] = useState(0);
    force = () => bump((value) => value + 1);
    const tag = location.state as { __peRouteTab?: { id: string } };
    return (
      <Activity mode={folded ? "hidden" : "visible"}>
        <RouteRetention
          route={
            location.pathname === "/ducts"
              ? "ducts"
              : location.pathname === "/families"
                ? "families"
                : null
          }
          active={ready && tag.__peRouteTab ? tag.__peRouteTab : null}
          tabs={tabs}
          ready={ready}
          renderRoute={(body) => body}
        />
      </Activity>
    );
  }
  const root = createRootRoute({ component: Root });
  const ducts = createRoute({
    getParentRoute: () => root,
    path: "/ducts",
    component: DuctProbe,
    validateSearch: (search) => ({ ...routeSearch(search), ...url.read(search) }),
    search: { middlewares: [...url.middlewares] },
  });
  const families = createRoute({
    getParentRoute: () => root,
    path: "/families",
    component: OtherProbe,
    validateSearch: (search) => ({
      ...routeSearch(search),
      ...urlPage(otherManifest)!.read(search),
    }),
  });
  const pea = createRoute({ getParentRoute: () => root, path: "/pea" });
  const history = createMemoryHistory({
    initialEntries: ["/ducts?thread=t&target=A&selected=101"],
  });
  const router = createRouter({ routeTree: root.addChildren([ducts, families, pea]), history });
  await router.load();
  if (enrolled)
    await router.navigate({
      to: "/ducts",
      search: router.state.location.search,
      state: { __peRouteTab: { id: "A", route: "ducts" } },
      replace: true,
    } as never);
  render(
    strict ? (
      <StrictMode>
        <RouterProvider router={router} />
      </StrictMode>
    ) : (
      <RouterProvider router={router} />
    ),
  );
  await waitFor(() => expect(probes.get("A")?.handle.page[0].selected).toBe("101"));
  const go = async (
    id: string,
    route: "ducts" | "families" = "ducts",
    extra: Record<string, unknown> = {},
  ) => {
    await act(() =>
      router.navigate({
        to: `/${route}`,
        search: { thread: "t", target: id, ...extra },
        state: { __peRouteTab: { id, route } },
      } as never),
    );
  };
  return {
    router,
    history,
    go,
    fold: async (value: boolean) => {
      folded = value;
      await act(async () => force());
    },
    enroll: async () => {
      ready = true;
      await act(() =>
        router.navigate({
          to: "/ducts",
          search: router.state.location.search,
          state: { __peRouteTab: { id: "A", route: "ducts" } },
          replace: true,
        } as never),
      );
    },
    close: async (id: string) => {
      tabs = tabs.filter((item) => item.id !== id);
      await act(async () => force());
    },
    redraw: async () => {
      await act(async () => force());
    },
  };
}

beforeEach(() => {
  probes.clear();
  running.clear();
  wire.length = 0;
  subscriptions.length = 0;
  frames.clear();
  native.mockClear();
  revision = 0;
  vi.spyOn(window, "scrollTo").mockImplementation(() => {});
  vi.spyOn(peReadings, "subscribe").mockImplementation((request, accept) => {
    if (request.kind === "world") frames.add(accept);
    const release = vi.fn(() => frames.delete(accept));
    subscriptions.push({ kind: request.kind, release });
    if (request.kind === "work")
      accept({
        kind: "snapshot",
        key: readingKey(request),
        value: { revision: 0, doc: ductsRouteState.schema.parse({ assumptions: {} }) },
      });
    return release;
  });
  vi.spyOn(peClient, "call").mockImplementation((async (operation: string, input: unknown) => {
    wire.push({ operation, input });
    return operation === "view.publish" ? { revision: ++revision } : {};
  }) as typeof peClient.call);
});

test("folding the outer tools Activity preserves the Page writer until its Place closes", async () => {
  const { fold, close, go } = await mount({ strict: true });
  const a = probes.get("A")!;
  act(() => a.handle.page[1]({ selected: "before-fold", viewport: poseA }));
  await fold(true);
  await act(() => new Promise((resolve) => setTimeout(resolve, 5)));
  expect(a.disposed).not.toHaveBeenCalled();
  await fold(false);
  expect(probes.get("A")!.instance).toBe(a.instance);
  act(() => probes.get("A")!.handle.page[1]({ selected: "after-fold", viewport: poseB }));
  expect(probes.get("A")!.handle.page[0]).toMatchObject({
    selected: "after-fold",
    viewport: poseB,
  });
  await go("B");
  await close("A");
  await waitFor(() => expect(a.disposed).toHaveBeenCalledTimes(1));
});

test("an action admitted while visible finishes native receipt and Work bookkeeping after hiding; new hidden writes refuse", async () => {
  const { go } = await mount();
  const a = probes.get("A")!;
  await waitFor(() => expect(probes.get("A")!.handle.work.current).toBe(true));
  const write = vi
    .spyOn(routeHost, "postRouteWrite")
    .mockImplementation(async (_op, _input, body) => {
      const { expectedRevision, press, patches, kind } = workWriteSchema.parse(body);
      return {
        status: 200,
        result: {
          ok: true,
          revision: expectedRevision + 1,
          write: {
            key: a.handle.work.key,
            kind,
            by: "human",
            press,
            base: expectedRevision,
            revision: expectedRevision + 1,
            patches,
            inverse: [],
            undoable: true,
          },
        },
      };
    });
  let finish!: () => void;
  const nativeReceipt = new Promise<void>((resolve) => {
    finish = resolve;
  });
  native.mockImplementationOnce(async (ctx) => {
    await nativeReceipt;
    await ctx.write([{ op: "set", path: ["assumptions", "receipt"], value: "landed" }]);
    return null;
  });
  let completion!: Promise<unknown>;
  act(() => {
    completion = probes.get("A")!.handle.actions.native.run();
  });
  await go("B");
  expect(a.disposed).not.toHaveBeenCalled();
  expect((await a.handle.work.write([]))?.message).toMatch(/hidden/);
  await act(async () => {
    finish();
    expect(await completion).toBeNull();
  });
  expect(write).toHaveBeenCalledTimes(1);
  expect(write.mock.calls[0]![2]).toMatchObject({
    expectedRevision: 0,
    patches: [{ op: "set", path: ["assumptions", "receipt"], value: "landed" }],
  });
  await go("A", "ducts", { selected: "101" });
  expect(probes.get("A")!.handle.outcome).toMatchObject({
    key: "native",
    refusal: null,
    stopped: false,
  });
  expect(
    probes.get("A")!.handle.log.some((entry) => entry.action === "native" && entry.says === "ran"),
  ).toBe(true);
  const queued = probes.get("A")!.handle.work.write([], 0);
  await go("B");
  expect(await queued).toBeNull();
  expect(write.mock.calls.at(-1)![2]).toMatchObject({ expectedRevision: 1 });
});
afterEach(async () => {
  cleanup();
  await new Promise((resolve) => setTimeout(resolve, 5));
  vi.restoreAllMocks();
});

test("two actual Page owners retain independent selection, viewport, draft and DOM scroll; hidden effects and stale callbacks cannot own history or native actions", async () => {
  const { router, history, go, redraw } = await mount();
  const a = probes.get("A")!;
  expect(probes.has("B")).toBe(false);
  const aNode = document.querySelector('[data-probe="A"]')!;
  fireEvent.change(aNode.querySelector("input")!, { target: { value: "draft A" } });
  const aScroll = aNode.closest<HTMLElement>("[data-route-tab]")!;
  aScroll.scrollTop = 147;
  await act(async () => a.handle.page[1]({ selected: "202", viewport: poseA }));
  await waitFor(() => expect(String(router.state.location.search.selected)).toBe("202"));
  await go("B", "ducts", { selected: "303", viewport: "orbit:90,20,2@1,2,3" });
  await waitFor(() => expect(probes.get("B")?.handle.page[0].selected).toBe("303"));
  expect(probes.get("A")!.handle.page[0].selected).toBe("202");
  expect(running).toEqual(new Set(["B"]));
  expect(a.disposed).not.toHaveBeenCalled();
  const before = history.length;
  await act(async () => {
    await a.navigate({ to: "/families" } as never);
    expect((await a.handle.actions.native.run())?.message).toMatch(/hidden/);
  });
  fireEvent.keyDown(window, { key: "F8" });
  await waitFor(() => expect(native).toHaveBeenCalledTimes(1));
  expect(history.length).toBe(before);
  expect(router.state.location.search.target).toBe("B");
  await redraw();
  expect(probes.get("A")!.search.target).toBe("A");
  await go("A", "ducts", { selected: "202", viewport: "orbit:45,30,1.25@0,0,0" });
  expect(probes.get("A")!.instance).toBe(a.instance);
  expect(document.querySelector('[data-probe="A"]')).toBe(aNode);
  expect(aNode.querySelector("input")!.value).toBe("draft A");
  expect(aScroll.scrollTop).toBe(147);
  expect(probes.get("A")!.handle.page[0].viewport).toEqual(poseA);
  expect(probes.get("B")!.handle.page[0].viewport).toEqual(poseB);
  await act(async () => history.back());
  await waitFor(() => expect(router.state.location.search.target).toBe("B"));
  expect(probes.get("A")!.handle.page[0].selected).toBe("202");
  expect(probes.get("B")!.handle.page[0].selected).toBe("303");
  await act(async () => history.forward());
  await waitFor(() => expect(router.state.location.search.target).toBe("A"));
  expect(probes.get("A")!.handle.page[0].selected).toBe("202");
});

test("a hidden leaf never becomes another route; chat retains it, close disposes it, and a chat switch keeps it", async () => {
  const { router, go, close } = await mount();
  const a = probes.get("A")!;
  await go("C", "families");
  expect(document.querySelectorAll('[data-probe="families"]')).toHaveLength(1);
  expect(document.querySelector('[data-probe="A"]')).not.toBeNull();
  expect(running.size).toBe(0);
  await act(() => router.navigate({ to: "/pea", search: { thread: "t" } } as never));
  expect(a.disposed).not.toHaveBeenCalled();
  await close("A");
  await waitFor(() => expect(a.disposed).toHaveBeenCalledTimes(1));
  expect(applyPageIntent(a.handle.page[0], () => a.handle.page[1]({ selected: "404" })).ok).toBe(
    false,
  );
  expect(document.querySelector('[data-probe="A"]')).toBeNull();
  await go("B");
  const b = probes.get("B")!;
  await act(() =>
    router.navigate({
      to: "/ducts",
      search: { ...router.state.location.search, thread: "another" },
      state: router.state.location.state,
    } as never),
  );
  // Retention keys by Place id: the selected conversation changes without remounting the body.
  await waitFor(() => expect(probes.get("B")!.search.thread).toBe("another"));
  expect(probes.get("B")!.instance).toBe(b.instance);
  expect(b.disposed).not.toHaveBeenCalled();
});

test("enrollment and lazy promotion preserve the initial Page, draft, and identity under StrictMode; a source change intentionally replaces it", async () => {
  const { router, enroll } = await mount({ enrolled: false, strict: true });
  const a = probes.get("A")!;
  fireEvent.change(document.querySelector('[data-probe="A"] input')!, {
    target: { value: "unsent" },
  });
  await enroll();
  expect(probes.get("A")!.instance).toBe(a.instance);
  expect(a.disposed).not.toHaveBeenCalled();
  await act(() =>
    router.navigate({
      to: "/ducts",
      search: { ...router.state.location.search, thread: "promoted" },
      state: {
        __peRouteTab: { id: "A", route: "ducts" },
      },
      replace: true,
    } as never),
  );
  expect(probes.get("A")!.instance).toBe(a.instance);
  expect(probes.get("A")!.search.thread).toBe("promoted");
  expect(probes.get("A")!.handle.page[0].selected).toBe("101");
  expect((document.querySelector('[data-probe="A"] input') as HTMLInputElement).value).toBe(
    "unsent",
  );
  await act(() =>
    router.navigate({
      to: "/ducts",
      search: { ...router.state.location.search, demo: "scene" },
      state: router.state.location.state,
      replace: true,
    } as never),
  );
  expect(probes.get("A")!.instance).not.toBe(a.instance);
  await waitFor(() => expect(a.disposed).toHaveBeenCalledTimes(1));
  expect(probes.get("A")!.demo).toBe("scene");
});

test("leases belong to the visible tab; a hidden instance cannot apply or acknowledge an intent, and untagged same-path navigation cannot restore its old Page", async () => {
  const { router, go } = await mount();
  await waitFor(() => expect(wire.some((call) => call.operation === "view.publish")).toBe(true));
  const first = wire.findLast((call) => call.operation === "view.publish")!.input.body;
  const listeners = [...frames];
  await go("B", "ducts", { selected: "303" });
  await waitFor(() =>
    expect(
      wire.some(
        (call) => call.operation === "view.remove" && call.input.params.instance === first.instance,
      ),
    ).toBe(true),
  );
  const pubs = wire.filter(
    (call) => call.operation === "view.publish" && call.input.body.instance === first.instance,
  ).length;
  await act(async () => {
    for (const accept of listeners)
      accept({
        kind: "event",
        value: {
          type: "route-view-intent",
          route: "ducts",
          thread: "t",
          instance: first.instance,
          revision: 1,
          commandId: "hidden",
          patch: { selected: "999" },
        },
      } as never);
  });
  expect(probes.get("A")!.handle.page[0].selected).toBe("101");
  expect(
    wire.filter(
      (call) => call.operation === "view.publish" && call.input.body.instance === first.instance,
    ),
  ).toHaveLength(pubs);
  expect(
    wire.some((call) => call.operation === "view.ack" && call.input.body.commandId === "hidden"),
  ).toBe(false);
  await waitFor(() =>
    expect(
      wire.some(
        (call) => call.operation === "view.publish" && call.input.body.context.target === "B",
      ),
    ).toBe(true),
  );
  const visible = wire.findLast((call) => call.operation === "view.publish")!.input.body;
  const visibleRevision = revision;
  await act(async () => {
    for (const accept of frames)
      accept({
        kind: "event",
        value: {
          type: "route-view-intent",
          route: "ducts",
          thread: "t",
          instance: visible.instance,
          revision: visibleRevision,
          commandId: "visible",
          patch: { selected: "404" },
        },
      } as never);
  });
  await waitFor(() =>
    expect(
      wire.some(
        (call) =>
          call.operation === "view.ack" &&
          call.input.body.commandId === "visible" &&
          call.input.body.outcome === "rendered",
      ),
    ).toBe(true),
  );
  expect(document.querySelector('[data-probe="B"] output')!.textContent).toContain("404");
  const b = probes.get("B")!;
  // History notifies old listeners synchronously, before the retention bank can select a tree.
  act(() => router.history.push("/ducts?thread=t&target=A&selected=808", {}));
  expect(b.handle.page[0].selected).toBe("404");
  await waitFor(() => expect(String(router.state.location.search.selected)).toBe("808"));
});

test("revealing an Activity resamples document visibility after missing its foreground event", async () => {
  const { go } = await mount();
  await waitFor(() => expect(wire.some((call) => call.operation === "view.publish")).toBe(true));
  const instance = wire.findLast((call) => call.operation === "view.publish")!.input.body.instance;
  const visibility = vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
  await act(async () => {
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await go("B");
  visibility.mockReturnValue("visible");
  await act(async () => {
    document.dispatchEvent(new Event("visibilitychange"));
  });
  const before = wire.filter(
    (call) => call.operation === "view.publish" && call.input.body.instance === instance,
  ).length;
  await go("A", "ducts", { selected: "101" });
  await waitFor(() =>
    expect(
      wire.filter(
        (call) => call.operation === "view.publish" && call.input.body.instance === instance,
      ).length,
    ).toBeGreaterThan(before),
  );
});

test("only visited trees mount and even an extra unpersisted deep link cannot retain more than twelve", async () => {
  const { go } = await mount({ many: true });
  expect(document.querySelectorAll("[data-route-tab]")).toHaveLength(1);
  const first = probes.get("A")!;
  for (let index = 0; index < 11; index++) await go(`T${index}`);
  expect(document.querySelectorAll("[data-route-tab]")).toHaveLength(12);
  expect(first.disposed).not.toHaveBeenCalled();
  await go("unpersisted");
  expect(document.querySelectorAll("[data-route-tab]")).toHaveLength(12);
  await waitFor(() => expect(first.disposed).toHaveBeenCalledTimes(1));
});
