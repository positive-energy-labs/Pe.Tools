import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter, useRouterState } from "@tanstack/react-router";
import {
  THREAD_TABS_MAX,
  documentRequestSchema,
  linkTo,
  readLink,
  routeAddresses,
  tabLink,
  type DocumentRequest,
  type Carry,
  type LinkPage,
  type RouteField,
  type RouteKey,
  type ThreadHead,
  type ThreadTab,
  type ThreadTabRequest,
} from "@pe/agent-contracts";
import { peClient } from "#/host/pe-client";
import { previousOf, useReading } from "#/readings";
import { useSurfaceHost } from "#/navigation/surface-host";
import { useWorkbench } from "./provider";

const routes = Object.keys(routeAddresses) as RouteKey[];
const focusKey = (thread: string) => `pe.tab.${thread}`;
const readFocus = (thread: string) => {
  try {
    return sessionStorage.getItem(focusKey(thread));
  } catch {
    return null;
  }
};
const focus = (thread: string, id: string | null) => {
  try {
    if (id) sessionStorage.setItem(focusKey(thread), id);
    else sessionStorage.removeItem(focusKey(thread));
  } catch {
    /* The URL still owns the Place if browser storage is unavailable. */
  }
};

/** Only registered shareable fields and explicit target/work survive in a durable Place. */
function place(route: RouteKey, search: Record<string, unknown>, target: DocumentRequest | null) {
  const { page, carry } = readLink(route, search);
  const fields: Record<string, RouteField> = routeAddresses[route].fields;
  const shared = Object.fromEntries(
    Object.entries(page).filter(([key]) => fields[key]?.share !== false),
  );
  return linkTo(route, shared, {
    target: carry.target ?? (target ? JSON.stringify(target) : undefined),
    work: carry.work,
  });
}

type Active = { thread: string; id: string; route: RouteKey; link: string };
type Snapshot = { thread: string; tabs: ThreadTab[]; ready: boolean };
type TabHistory = {
  __peMintedThread?: string;
  __peRouteTab?: { thread: string; id: string; route: RouteKey };
};
const historyOf = (state: unknown) => state as TabHistory;
const wasMinted = (thread: string, state: unknown) => {
  if (historyOf(state).__peMintedThread === thread) return true;
  try {
    return sessionStorage.getItem(`pe.routeThread.${thread}`) === "minted";
  } catch {
    return false;
  }
};

/** Host owns tab records; URL/history and sessionStorage own this browser's focus. */
export function useRouteTabs() {
  const { store, currentThreadId: thread, threads, providers } = useWorkbench();
  const router = useRouter();
  const surface = useSurfaceHost().surface;
  const location = useRouterState({ select: (state) => state.location });
  const legacy =
    location.pathname === "/pea" &&
    ["plugin", "focus"].some((key) => new URLSearchParams(location.searchStr).has(key));
  const route =
    routes.find((key) => key !== "pea" && routeAddresses[key].path === location.pathname) ?? null;
  const headReading = useReading<ThreadHead>(thread ? { kind: "thread-head", thread } : null);
  const head = previousOf(headReading);
  const carry = readLink(route ?? "pea", location.search).carry;
  const pinned = (() => {
    if (!carry.target) return head?.defaultTarget ?? null;
    try {
      return documentRequestSchema.safeParse(JSON.parse(carry.target)).data ?? null;
    } catch {
      return null;
    }
  })();
  const link = route ? place(route, location.search, head?.defaultTarget ?? null) : null;
  const [snapshot, setSnapshot] = useState<Snapshot>({ thread: "", tabs: [], ready: false });
  const [failure, setFailure] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  const held = useRef<Active | null>(null);
  const pending = useRef(new Map<string, Active>());
  const serial = useRef(Promise.resolve());
  const navigationEpoch = useRef(0);
  const liveThread = useRef(thread);
  liveThread.current = thread;
  const shown = snapshot.thread === thread ? snapshot : { thread, tabs: [], ready: false };
  const tabs = shown.tabs;
  const known = threads.find((item) => item.id === thread);
  const providerState = providers.list;
  const creationTarget = JSON.stringify(pinned);

  useEffect(() => {
    if (!thread || known) return;
    let cancelled = false;
    void peClient
      .call("thread.get", { params: { id: thread } })
      .then((summary) => {
        if (!cancelled) setSnapshot({ thread, tabs: summary.tabs, ready: true });
      })
      .catch(async (error: unknown) => {
        if (cancelled) return;
        const minted = wasMinted(thread, router.state.location.state);
        if (
          (error as { status?: number }).status === 404 &&
          minted &&
          headReading.state === "ready"
        ) {
          try {
            const created = await store.actions.ensureThread(thread, pinned);
            if (created) {
              try {
                sessionStorage.removeItem(`pe.routeThread.${thread}`);
              } catch {
                /* Issuance is local recovery state only. */
              }
            }
          } catch (caught) {
            if (!cancelled) setFailure(caught instanceof Error ? caught.message : String(caught));
          }
        } else setFailure(error instanceof Error ? error.message : String(error));
      });
    return () => {
      cancelled = true;
    };
  }, [thread, known?.id, retry, providerState, headReading.state, creationTarget, store, router]);

  // Summary notifications may change the strip, never this browser's active URL or owner.
  useEffect(() => {
    if (known) setSnapshot({ thread, tabs: known.tabs, ready: true });
  }, [thread, known?.tabs]);

  if (route && link && thread && shown.ready) {
    const history = historyOf(location.state).__peRouteTab;
    const old = held.current;
    const local = tabs.find((tab) => tab.id === readFocus(thread) && tab.route === route);
    const matching = tabs.find((tab) => tab.route === route && tab.link === link);
    const id =
      history?.thread === thread && history.route === route && history.id
        ? history.id
        : old?.thread === thread && old.route === route
          ? old.id
          : (local?.id ?? matching?.id ?? crypto.randomUUID());
    held.current = { thread, id, route, link };
  } else if (!route || held.current?.thread !== thread) held.current = null;
  const active = route && held.current?.thread === thread ? held.current : null;

  // Tag the initial/deep-link entry too; the Page adapter preserves this state on its own moves.
  useEffect(() => {
    if (!active) return;
    const state = location.state;
    const tagged = historyOf(state).__peRouteTab;
    if (tagged?.thread === thread && tagged.id === active.id) return;
    void router.navigate({
      to: location.pathname,
      search: location.search,
      state: {
        ...state,
        __peRouteTab: { thread, id: active.id, route: active.route },
      },
      replace: true,
      ignoreBlocker: true,
    } as never);
  }, [router, thread, active?.id, location.pathname, location.search, location.state]);

  const write = useCallback((owner: string, body: ThreadTabRequest, current?: () => boolean) => {
    const task = serial.current
      .catch(() => {})
      .then(async () => {
        if (current && !current()) return null;
        const summary = await peClient.call(
          "thread.tabs",
          { params: { id: owner }, body },
          { keepalive: true },
        );
        if (liveThread.current === owner) {
          setSnapshot({ thread: owner, tabs: summary.tabs, ready: true });
          setFailure(null);
        }
        return summary;
      });
    serial.current = task.then(
      () => {},
      () => {},
    );
    return task;
  }, []);
  const flush = useCallback(async () => {
    // A fixed batch: a newer Place arriving during the await belongs to the next flush.
    const batch = [...pending.current];
    for (const [key, next] of batch) {
      const current = () => pending.current.get(key) === next;
      const saved = await write(
        next.thread,
        { op: "put", id: next.id, route: next.route, link: next.link },
        current,
      );
      if (saved && current()) pending.current.delete(key);
    }
  }, [write]);
  const fail = (error: unknown) =>
    setFailure(error instanceof Error ? error.message : String(error));

  useEffect(() => {
    if (!active) return;
    focus(thread, active.id);
    if (tabs.some((tab) => tab.id === active.id && tab.link === active.link)) return;
    pending.current.set(`${thread}:${active.id}`, { ...active });
    const timer = setTimeout(() => {
      void flush().catch(fail);
    }, 500);
    return () => clearTimeout(timer);
  }, [thread, active?.id, active?.link, flush]);

  useEffect(() => {
    const save = () => {
      void flush().catch(fail);
    };
    const unsubscribe = router.history.subscribe(({ action }) => {
      if (action.type === "BACK" || action.type === "FORWARD" || action.type === "GO") {
        navigationEpoch.current++;
        store.actions.cancelPlan();
      }
      save();
    });
    window.addEventListener("pagehide", save);
    return () => {
      unsubscribe();
      window.removeEventListener("pagehide", save);
      save();
    };
  }, [router, store, flush]);

  const navigate = async (
    owner: string,
    destination: string,
    id: string | null,
    replace = false,
  ) => {
    const url = new URL(destination, "http://tab.invalid");
    const search = Object.fromEntries(url.searchParams);
    focus(owner, id);
    await router.navigate({
      to: url.pathname,
      search: {
        ...search,
        thread: owner,
        target: search.target,
        work: search.work,
        // Local chrome decorates navigation, never the canonical persisted link.
        shell: surface === "tray" ? "tray" : undefined,
      },
      state: (previous: Record<string, unknown>) => ({
        ...previous,
        __peRouteTab: id
          ? {
              thread: owner,
              id,
              route: routes.find((key) => routeAddresses[key].path === url.pathname),
            }
          : undefined,
      }),
      replace,
    } as never);
  };
  const select = async (tab: ThreadTab, replace = false) => {
    const epoch = ++navigationEpoch.current;
    store.actions.cancelPlan();
    await flush();
    if (epoch === navigationEpoch.current && liveThread.current === thread)
      await navigate(thread, tab.link, tab.id, replace);
  };
  useEffect(() => {
    if (route || legacy || location.pathname !== "/pea" || !thread || !shown.ready) return;
    const previous = tabs.find((tab) => tab.id === readFocus(thread)) ?? tabs[0];
    if (previous) void select(previous, true).catch(fail);
  }, [thread, route, legacy, location.pathname, shown.ready]);

  const open = async (
    key: string,
    page?: LinkPage<RouteKey>,
    explicit?: Pick<Carry, "target" | "work">,
    duplicate = false,
  ) => {
    const epoch = ++navigationEpoch.current;
    const sourcePath = router.state.location.pathname;
    if (!Object.hasOwn(routeAddresses, key) || key === "pea") {
      setFailure(`This route has no saved Place contract: ${key}`);
      return false;
    }
    const targetRoute = key as RouteKey;
    try {
      if (thread && !shown.ready)
        throw Error(failure ?? "Thread Places are loading; retry when they are current.");
      await flush();
      let openingTarget = pinned;
      if (explicit?.target) {
        try {
          openingTarget = documentRequestSchema.safeParse(JSON.parse(explicit.target)).data ?? null;
        } catch {
          openingTarget = null;
        }
      }
      const owner = thread || (await store.actions.ensureThread(thread, openingTarget));
      if (!owner) return false;
      const existing = !duplicate && tabs.find((tab) => tab.route === targetRoute);
      if (!existing && tabs.length >= THREAD_TABS_MAX)
        throw Error(`A thread keeps ${THREAD_TABS_MAX} tabs; close one first.`);
      const nextLink =
        page === undefined && explicit === undefined && existing
          ? existing.link
          : linkTo(targetRoute, page ?? {}, {
              target:
                explicit?.target ?? carry.target ?? (pinned ? JSON.stringify(pinned) : undefined),
              work: explicit?.work ?? carry.work,
            });
      const canonical = tabLink(targetRoute, nextLink);
      if (!canonical.ok) throw Error(canonical.error);
      const id = existing ? existing.id : crypto.randomUUID();
      await write(owner, { op: "put", id, route: targetRoute, link: canonical.link });
      if (
        epoch !== navigationEpoch.current ||
        router.state.location.pathname !== sourcePath ||
        router.state.location.search.thread !== owner
      )
        return false;
      await navigate(owner, canonical.link, id);
      return (
        router.state.location.pathname === routeAddresses[targetRoute].path &&
        historyOf(router.state.location.state).__peRouteTab?.id === id
      );
    } catch (error) {
      fail(error);
      return false;
    }
  };
  useEffect(
    () => store.actions.connectTabs({ open }),
    [store, thread, link, tabs, pinned, carry.target, carry.work],
  );

  return {
    thread,
    route,
    tabs,
    active,
    target: carry.target,
    failure: legacy
      ? "This old workspace group link is unavailable; open a route and choose its exact subject."
      : failure,
    select: (tab: ThreadTab) => select(tab).catch(fail),
    chat: async () => {
      const epoch = ++navigationEpoch.current;
      store.actions.cancelPlan();
      try {
        await flush();
        if (epoch !== navigationEpoch.current || liveThread.current !== thread) return;
        await navigate(thread, linkTo("pea", {}, { target: carry.target, work: carry.work }), null);
      } catch (error) {
        fail(error);
      }
    },
    close: async (tab: Pick<ThreadTab, "id">) => {
      const epoch = ++navigationEpoch.current;
      store.actions.cancelPlan();
      try {
        // Closing discards this Place; a refused thirteenth Place must not prevent freeing a slot.
        if (pending.current.has(`${thread}:${tab.id}`))
          pending.current.delete(`${thread}:${tab.id}`);
        else await flush().catch(fail);
        const result = await write(thread, { op: "close", id: tab.id });
        if (!result) return;
        if (pending.current.size) await flush().catch(fail);
        if (
          epoch === navigationEpoch.current &&
          held.current?.id === tab.id &&
          liveThread.current === thread
        ) {
          const next =
            result.tabs[
              Math.min(
                tabs.findIndex((item) => item.id === tab.id),
                result.tabs.length - 1,
              )
            ];
          await navigate(thread, next?.link ?? linkTo("pea"), next?.id ?? null, true);
        }
      } catch (error) {
        fail(error);
      }
    },
    duplicate: async () => {
      store.actions.cancelPlan();
      if (active)
        await open(active.route, readLink(active.route, location.search).page, undefined, true);
    },
    retry: () => {
      void flush().catch(fail);
      setRetry((value) => value + 1);
    },
  };
}
