import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter, useRouterState } from "@tanstack/react-router";
import {
  routeAddress,
  THREAD_TABS_MAX,
  documentRequestSchema,
  routeAt,
  type DocumentRequest,
  type Carry,
  type LinkPage,
  type RouteKey,
  type ThreadHead,
  type ThreadTab,
  type ThreadTabRequest,
  type WorkKey,
  sameAddress,
} from "@pe/agent-contracts";
import { peClient } from "#/host/pe-client";
import { focusQuiet } from "@pe/kit/lib/utils";
import { previousOf, useReading } from "#/readings";
import { useSurfaceHost } from "#/navigation/surface-host";
import { useWorkbench } from "./provider";
import { routeThreadIssue } from "./store";
import { soleRequest } from "#/chat/thread-navigation";
import { parseTarget } from "#/route/route-target";

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
function place(
  route: RouteKey,
  search: Record<string, unknown>,
  target: DocumentRequest | null,
  local: boolean,
) {
  const { page, carry } = routeAddress(route).read(search);
  const link = routeAddress(route).link(page, {
    target: carry.target ?? (target ? JSON.stringify(target) : undefined),
    work: carry.work,
  });
  // A `?demo=` seed rides its fixture Place, which stays in this browser (`store.local`).
  return local && typeof search.demo === "string"
    ? `${link}${link.includes("?") ? "&" : "?"}demo=${encodeURIComponent(search.demo)}`
    : link;
}

/** Whether a saved Place holds the Work `key` names: the same named workspace, the same stable
 *  Address (case and separators do not matter), or the exact open lifetime the key carries. A
 *  session key or a title never matches; with no proof the answer is no. */
function holdsWork(tab: ThreadTab, key: WorkKey): boolean {
  const { carry } = routeAddress(tab.route).read(
    Object.fromEntries(new URL(tab.link, "http://tab.invalid").searchParams),
  );
  if (key.binding === "workspace") return carry.work === key.work;
  if (carry.work !== undefined) return false;
  const target = parseTarget(carry.target);
  const request = target?.kind === "request" ? target.request : null;
  const open = request?.kind === "open" ? request.ref : null;
  const address =
    target?.kind === "address"
      ? target.address
      : request?.kind === "named"
        ? request.address
        : null;
  const sameRef = (ref?: { session: string; openId: string }) =>
    open !== null &&
    ref !== undefined &&
    open.session === ref.session &&
    open.openId === ref.openId;
  if (key.binding === "address")
    return address ? sameAddress(address, key.target) : sameRef(key.from);
  if (key.binding === "open") return sameRef(key.open);
  return target === null;
}

/** The route a tab holds at `pathname`: any but Pea's own page. */
const tabRouteAt = (pathname: string) => {
  const route = routeAt(pathname);
  return route === "pea" ? null : route;
};

type Active = { thread: string; id: string; route: RouteKey; link: string };
type Snapshot = { thread: string; tabs: ThreadTab[]; ready: boolean };
type TabHistory = {
  __pePromotedThread?: string;
  __peMintedThread?: string;
  __peRouteTab?: { thread: string; id: string; route: RouteKey };
};
const historyOf = (state: unknown) => state as TabHistory;

/** Host owns tab records; URL/history and sessionStorage own this browser's focus. */
export function useRouteTabs() {
  const { store, threads } = useWorkbench();
  const router = useRouter();
  const surface = useSurfaceHost().surface;
  const location = useRouterState({ select: (state) => state.location });
  const thread = location.search.thread ?? "";
  const draft = routeThreadIssue(thread, location.state) === "minted";
  const legacy =
    location.pathname === "/pea" &&
    ["plugin", "focus"].some((key) => new URLSearchParams(location.searchStr).has(key));
  const route = tabRouteAt(location.pathname);
  const headReading = useReading<ThreadHead>(thread ? { kind: "thread-head", thread } : null);
  const head = previousOf(headReading);
  const carry = routeAddress(route ?? "pea").read(location.search).carry;
  const pinned = (() => {
    if (!carry.target) return head ? soleRequest(head) : null;
    try {
      return documentRequestSchema.safeParse(JSON.parse(carry.target)).data ?? null;
    } catch {
      return null;
    }
  })();
  const link = route
    ? place(route, location.search, head ? soleRequest(head) : null, store.local)
    : null;
  const [snapshot, setSnapshot] = useState<Snapshot>({ thread: "", tabs: [], ready: false });
  const [failure, setFailure] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  const held = useRef<Active | null>(null);
  const pending = useRef(new Map<string, Active>());
  const serial = useRef(Promise.resolve());
  const written = useRef(new Set<string>());
  const navigationEpoch = useRef(0);
  const liveThread = useRef(thread);
  liveThread.current = thread;
  const shown = draft
    ? { thread, tabs: store.actions.draftTabs(thread), ready: true }
    : snapshot.thread === thread
      ? snapshot
      : { thread, tabs: [], ready: false };
  const tabs = shown.tabs;
  const known = threads.find((item) => item.id === thread);

  useEffect(() => {
    if (!thread || known || draft) {
      setFailure(null);
      return;
    }
    let cancelled = false;
    void peClient
      .call("thread.get", { params: { id: thread } })
      .then((summary) => {
        if (!cancelled) {
          setSnapshot({ thread, tabs: summary.tabs, ready: true });
          setFailure(null);
        }
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setFailure(error instanceof Error ? error.message : String(error));
      });
    return () => {
      cancelled = true;
    };
  }, [thread, known?.id, retry, draft]);

  // Summary notifications may change the strip, never this browser's active URL or owner, with one
  // exception: a tab that arrives from the host while this browser shows the thread's chat is Pea
  // opening a tool (`route:<tool>.set-view`), so it opens beside the chat.
  // ponytail: "not written here" stands in for "written by Pea"; a tab the person opens in another
  // window also opens here. A host-stamped opener on the tab replaces this if that bites.
  const seen = useRef<{ thread: string; ids: Set<string> } | null>(null);
  useEffect(() => {
    if (!known) return;
    const prior = seen.current?.thread === thread ? seen.current.ids : null;
    seen.current = { thread, ids: new Set(known.tabs.map((tab) => tab.id)) };
    setSnapshot({ thread, tabs: known.tabs, ready: true });
    const arrived = prior
      ? known.tabs.find((tab) => !prior.has(tab.id) && !written.current.has(tab.id))
      : undefined;
    if (arrived && !route && location.pathname === "/pea" && document.visibilityState === "visible")
      void select(arrived).catch(fail);
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
  const active =
    route && held.current?.thread === thread && held.current.route === route ? held.current : null;

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

  const write = useCallback(
    (owner: string, body: ThreadTabRequest, current?: () => boolean, local = false) => {
      const task = serial.current
        .catch(() => {})
        .then(async () => {
          if (current && !current()) return null;
          written.current.add(body.id);
          let summary: { tabs: ThreadTab[] };
          if (
            local ||
            store.local ||
            routeThreadIssue(owner, router.state.location.state) === "minted"
          ) {
            const prior = store.actions.draftTabs(owner);
            let tabs: ThreadTab[];
            if (body.op === "close") tabs = prior.filter((tab) => tab.id !== body.id);
            else {
              const existing = prior.some((tab) => tab.id === body.id);
              if (!existing && prior.length >= THREAD_TABS_MAX)
                throw Error(`A thread keeps ${THREAD_TABS_MAX} tabs; close one first.`);
              const next = {
                id: body.id,
                route: body.route,
                link: body.link,
                at: new Date().toISOString(),
              };
              tabs = existing
                ? prior.map((tab) => (tab.id === body.id ? next : tab))
                : [...prior, next];
            }
            store.actions.saveDraftTabs(owner, tabs);
            summary = { tabs };
          } else
            summary = await peClient.call(
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
    },
    [router, store],
  );
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
    if (draft) {
      void write(thread, {
        op: "put",
        id: active.id,
        route: active.route,
        link: active.link,
      }).catch(fail);
      return;
    }
    pending.current.set(`${thread}:${active.id}`, { ...active });
    const timer = setTimeout(() => {
      void flush().catch(fail);
    }, 500);
    return () => clearTimeout(timer);
  }, [thread, active?.id, active?.link, flush, draft, write]);

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
    issued = false,
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
              route: routeAt(url.pathname) ?? undefined,
            }
          : undefined,
        __peMintedThread:
          issued || routeThreadIssue(owner, previous) === "minted" ? owner : undefined,
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
  const open = async <R extends RouteKey>(
    targetRoute: R,
    page?: LinkPage<R>,
    explicit?: Pick<Carry, "target" | "work">,
    duplicate = false,
    /** Land `page` on the route's open tab without resetting the fields it does not name. */
    keep = false,
  ) => {
    const epoch = ++navigationEpoch.current;
    const sourcePath = router.state.location.pathname;
    if (targetRoute === "pea") {
      setFailure(`This route has no saved Place contract: ${targetRoute}`);
      return false;
    }
    try {
      if (thread && !shown.ready)
        throw Error(failure ?? "Thread Places are loading; retry when they are current.");
      await flush();
      const owner = thread || crypto.randomUUID();
      if (!thread) {
        try {
          sessionStorage.setItem(`pe.routeThread.${owner}`, "minted");
        } catch {
          /* Navigation carries issuance too. */
        }
      }
      const existing = !duplicate && tabs.find((tab) => tab.route === targetRoute);
      if (!existing && tabs.length >= THREAD_TABS_MAX)
        throw Error(`A thread keeps ${THREAD_TABS_MAX} tabs; close one first.`);
      const nextLink =
        page === undefined && explicit === undefined && existing
          ? existing.link
          : routeAddress(targetRoute).link(
              keep && existing
                ? ({
                    ...routeAddress(targetRoute).read(
                      Object.fromEntries(new URL(existing.link, "http://tab").searchParams),
                    ).page,
                    ...page,
                  } as LinkPage<R>)
                : page,
              {
                target:
                  explicit?.target ?? carry.target ?? (pinned ? JSON.stringify(pinned) : undefined),
                work: explicit?.work ?? carry.work,
              },
            );
      const canonical = routeAddress(targetRoute).tab(nextLink);
      if (!canonical.ok) throw Error(canonical.error);
      const id = existing ? existing.id : crypto.randomUUID();
      await write(
        owner,
        { op: "put", id, route: targetRoute, link: canonical.link },
        undefined,
        !thread || draft,
      );
      if (
        epoch !== navigationEpoch.current ||
        router.state.location.pathname !== sourcePath ||
        (router.state.location.search.thread ?? "") !== thread
      )
        return false;
      await navigate(owner, canonical.link, id, false, !thread || draft);
      return (
        router.state.location.pathname === routeAddress(targetRoute).path &&
        historyOf(router.state.location.state).__peRouteTab?.id === id
      );
    } catch (error) {
      fail(error);
      return false;
    }
  };
  useEffect(
    () =>
      store.actions.connectTabs({
        open,
        // A Work press may name another thread. The tab that holds that Work restores its own Page
        // and id; with none, the resumed url (or the bare route) opens as a new Place.
        work: async (owner, workRoute, resumed) => {
          const epoch = ++navigationEpoch.current;
          try {
            await flush();
            const onRoute = (
              owner === thread ? tabs : threads.find((t) => t.id === owner)?.tabs
            )?.filter((tab) => tab.route === workRoute);
            // Exception to "match by Work identity": `?demo=` asks the host nothing, so it has no
            // key. Its fixture holds one tab per route and never reaches a host thread.
            const saved = resumed?.key
              ? onRoute?.find((tab) => holdsWork(tab, resumed.key!))
              : store.local
                ? onRoute?.[0]
                : undefined;
            if (epoch !== navigationEpoch.current) return;
            await navigate(
              owner,
              saved?.link ?? resumed?.url ?? routeAddress(workRoute as RouteKey).link(),
              saved?.id ?? null,
            );
            // The press was outside the tools: focus lands on the tool it opened, not the press.
            focusQuiet(document.querySelector<HTMLElement>('[data-pane-id="tools"]'));
          } catch (error) {
            fail(error);
          }
        },
        promote: async (from, owner, current) => {
          const location = router.state.location;
          const route = tabRouteAt(location.pathname);
          if (route && from) {
            const id =
              historyOf(location.state).__peRouteTab?.id ?? held.current?.id ?? crypto.randomUUID();
            await write(
              from,
              {
                op: "put",
                id,
                route,
                link: place(route, location.search, head ? soleRequest(head) : null, store.local),
              },
              current,
              true,
            );
          }
          await flush();
          const saved = store.actions.draftTabs(from);
          for (const tab of saved) {
            if (!current()) throw Error("The Place changed before its draft tabs were saved.");
            await write(owner, { op: "put", id: tab.id, route: tab.route, link: tab.link });
          }
          if (!current()) throw Error("The Place changed before its draft was promoted.");
          const selected = readFocus(from);
          focus(owner, selected);
          await router.navigate({
            to: router.state.location.pathname,
            search: (previous: Record<string, unknown>) => ({ ...previous, thread: owner }),
            state: (previous: Record<string, unknown>) => ({
              ...previous,
              __peMintedThread: undefined,
              __pePromotedThread: from,
              __peRouteTab: historyOf(previous).__peRouteTab
                ? { ...historyOf(previous).__peRouteTab!, thread: owner }
                : undefined,
            }),
            replace: true,
          } as never);
          store.actions.finishDraft(from, owner);
          setSnapshot({ thread: owner, tabs: saved, ready: true });
        },
      }),
    [store, thread, threads, link, tabs, pinned, carry.target, carry.work],
  );

  return {
    thread,
    route,
    tabs,
    active,
    ready: shown.ready,
    promotedFrom: historyOf(location.state).__pePromotedThread,
    target: carry.target,
    failure: legacy
      ? "This old workspace group link is unavailable; open a route and choose its exact subject."
      : failure,
    select: (tab: ThreadTab) => select(tab).catch(fail),
    /** Expand the collapsed tools on the tab this browser last showed. */
    resume: () => {
      const last = tabs.find((tab) => tab.id === readFocus(thread)) ?? tabs[0];
      if (last) void select(last).catch(fail);
    },
    chat: async () => {
      const epoch = ++navigationEpoch.current;
      store.actions.cancelPlan();
      try {
        await flush();
        if (epoch !== navigationEpoch.current || liveThread.current !== thread) return;
        await navigate(
          thread,
          routeAddress("pea").link({}, { target: carry.target, work: carry.work }),
          null,
        );
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
          await navigate(thread, next?.link ?? routeAddress("pea").link(), next?.id ?? null, true);
        }
      } catch (error) {
        fail(error);
      }
    },
    duplicate: async () => {
      store.actions.cancelPlan();
      if (active)
        await open(
          active.route,
          routeAddress(active.route).read(location.search).page,
          undefined,
          true,
        );
    },
    retry: () => {
      void flush().catch(fail);
      setRetry((value) => value + 1);
    },
  };
}
