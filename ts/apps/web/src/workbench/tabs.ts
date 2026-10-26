import { useCallback, useEffect, useRef, useState } from "react";
import { z } from "zod";
import { useRouter, useRouterState } from "@tanstack/react-router";
import {
  routeAddress,
  routeViewOpenSchema,
  THREAD_TABS_MAX,
  threadTabSchema,
  routeAt,
  sameAddress,
  type DocumentRef,
  type Carry,
  type LinkPage,
  type RouteKey,
  type RouteViewOpenIntent,
  type ThreadTab,
} from "@pe/agent-contracts";
import { peClient } from "#/host/pe-client";
import { focusQuiet } from "@pe/kit/lib/utils";
import { useHostEvents } from "#/readings";
import { useSurfaceHost } from "#/navigation/surface-host";
import type { Resumed } from "#/chat/thread-work";
import { useWorkbench } from "./provider";
import { parseTarget } from "#/route/route-target";

/*
 * Places (tool tabs) are browser-window-local: sessionStorage only, independent of the selected
 * conversation (ADR 0022). The host keeps no tab records for web; it learns display context only
 * through `thread.place`, on three explicit moments: a Work press or a Pea open in a selected real
 * chat, and a Send while a tool is the current Place.
 */
const PLACES = "pe.places";
const FOCUS = "pe.place.focus";
const read = (): ThreadTab[] => {
  try {
    return (
      threadTabSchema
        .array()
        .max(THREAD_TABS_MAX)
        .safeParse(JSON.parse(sessionStorage.getItem(PLACES) ?? "[]")).data ?? []
    );
  } catch {
    return [];
  }
};
const save = (tabs: ThreadTab[]) => {
  try {
    sessionStorage.setItem(PLACES, JSON.stringify(tabs));
  } catch {
    /* This window keeps its mounted Places. */
  }
};
const readFocus = () => {
  try {
    return sessionStorage.getItem(FOCUS);
  } catch {
    return null;
  }
};
const focus = (id: string | null) => {
  try {
    if (id) sessionStorage.setItem(FOCUS, id);
    else sessionStorage.removeItem(FOCUS);
  } catch {
    /* The URL still owns the Place. */
  }
};

/** Only registered shareable fields and an explicit target/work survive in a Place. */
function place(route: RouteKey, search: Record<string, unknown>, local: boolean) {
  const { page, carry } = routeAddress(route).read(search);
  const link = routeAddress(route).link(page, { target: carry.target, work: carry.work });
  // A `?demo=` seed rides its fixture Place.
  return local && typeof search.demo === "string"
    ? `${link}${link.includes("?") ? "&" : "?"}demo=${encodeURIComponent(search.demo)}`
    : link;
}

const params = (link: string) =>
  Object.fromEntries(new URL(link, "http://tab.invalid").searchParams);

/** A matched Place keeps its Page and id and takes the resume's stable binding. */
function rebased(tab: ThreadTab, url: string | null): string {
  const at = routeAddress(tab.route);
  const { page, carry } = at.read(params(tab.link));
  return url
    ? at.link(page, { target: at.read(params(url)).carry.target, work: carry.work })
    : tab.link;
}

/** A Place's binding: its canonical `?target` and `?work`; a Place is reused only on an exact one. */
const bindingOf = (route: RouteKey, link: string) => {
  const {
    page,
    carry: { target, work },
  } = routeAddress(route).read(params(link));
  // A published Page is a distinct subject, although it carries no Revit target or Work key.
  return JSON.stringify([
    target ?? null,
    work ?? null,
    route === "bind" && "page" in page ? page.page : null,
  ]);
};

const sameRef = (a: DocumentRef, b: DocumentRef) =>
  a.session === b.session && a.openId === b.openId;

/** Work key semantics: the Place names the same workspace, Address (or a known exact lifetime of
 *  it), or exact open document as the resumed Work. No route-only guess. */
function holdsWork(tab: ThreadTab, route: string, resumed: Resumed): boolean {
  const key = resumed.key;
  if (tab.route !== route || !key) return false;
  const { target: raw, work } = routeAddress(tab.route).read(params(tab.link)).carry;
  if (key.binding === "workspace") return work === key.work;
  if (work !== undefined) return false;
  const target = parseTarget(raw);
  const request = target?.kind === "request" ? target.request : null;
  const open = request?.kind === "open" ? request.ref : null;
  switch (key.binding) {
    case "host":
      return target === null;
    case "open":
      return open !== null && sameRef(open, key.open);
    case "address": {
      const address =
        target?.kind === "address"
          ? target.address
          : request?.kind === "named"
            ? request.address
            : null;
      if (address) return sameAddress(address, key.target);
      return (
        open !== null &&
        [...resumed.knownOpenRefs, ...(key.from ? [key.from] : [])].some((ref) =>
          sameRef(ref, open),
        )
      );
    }
  }
}

/** The route a tab holds at `pathname`: any but Pea's own page. */
const tabRouteAt = (pathname: string) => {
  const route = routeAt(pathname);
  return route === "pea" ? null : route;
};

type TabHistory = {
  __peRouteTab?: { id: string; route: RouteKey };
  /** The explicit Pea open this Place answers; page-local, never in the URL or a Place link. */
  __peViewOpenCommandId?: string;
};
const historyOf = (state: unknown) => (state ?? {}) as TabHistory;

/** This window's Places, and the moves between them; the selected `?thread` rides along unchanged. */
export function useRouteTabs() {
  const { store, threads } = useWorkbench();
  const router = useRouter();
  const surface = useSurfaceHost().surface;
  const location = useRouterState({ select: (state) => state.location });
  const thread = location.search.thread ?? "";
  const legacy =
    location.pathname === "/pea" &&
    ["plugin", "focus"].some((key) => new URLSearchParams(location.searchStr).has(key));
  const route = tabRouteAt(location.pathname);
  const carry = routeAddress(route ?? "pea").read(location.search).carry;
  const link = route ? place(route, location.search, store.local) : null;
  const [tabs, setTabs] = useState<ThreadTab[]>(read);
  const [failure, setFailure] = useState<string | null>(null);
  const fail = (error: unknown) =>
    setFailure(error instanceof Error ? error.message : String(error));
  const commit = (next: ThreadTab[]) => {
    save(next);
    setTabs(next);
    return next;
  };
  const put = (id: string, tabRoute: RouteKey, tabLink: string) => {
    const prior = read();
    const existing = prior.some((tab) => tab.id === id);
    if (!existing && prior.length >= THREAD_TABS_MAX)
      throw Error(`This window keeps ${THREAD_TABS_MAX} Places; close one first.`);
    const next = { id, route: tabRoute, link: tabLink, at: new Date().toISOString() };
    return commit(existing ? prior.map((tab) => (tab.id === id ? next : tab)) : [...prior, next]);
  };

  const tagged = historyOf(location.state).__peRouteTab;
  const active =
    route && link
      ? {
          id:
            // An explicit history tag, else the exact canonical link, else the focused Place only
            // when its binding is the URL's. A pasted URL never overwrites another Work's Place.
            (tagged?.route === route && tabs.some((tab) => tab.id === tagged.id)
              ? tagged.id
              : null) ??
            tabs.find((tab) => tab.route === route && tab.link === link)?.id ??
            tabs.find(
              (tab) =>
                tab.id === readFocus() &&
                tab.route === route &&
                bindingOf(route, tab.link) === bindingOf(route, link),
            )?.id ??
            null,
          route,
          link,
        }
      : null;

  // The visible tool is a Place: record its current link and tag history with its id.
  useEffect(() => {
    if (!active) return;
    try {
      // Enrollment is idempotent: a repeat run (StrictMode, or a re-render before the history tag
      // lands) reuses the record the first run stored for this exact link instead of minting another.
      const id =
        active.id ??
        read().find((tab) => tab.route === active.route && tab.link === active.link)?.id ??
        crypto.randomUUID();
      focus(id);
      if (!tabs.some((tab) => tab.id === id && tab.link === active.link))
        put(id, active.route, active.link);
      if (tagged?.id !== id || tagged.route !== active.route)
        void router.navigate({
          to: location.pathname,
          search: location.search,
          state: { ...location.state, __peRouteTab: { id, route: active.route } },
          replace: true,
          ignoreBlocker: true,
        } as never);
    } catch (error) {
      fail(error);
    }
  }, [active?.id, active?.link, active?.route, tagged?.id, tagged?.route]);

  // The command id names the last explicit open this Place rendered for its conversation; it
  // survives same-Place Page moves but not a change of the thread association.
  const lastThread = useRef(thread);
  useEffect(() => {
    if (lastThread.current === thread) return;
    lastThread.current = thread;
    if (!historyOf(router.state.location.state).__peViewOpenCommandId) return;
    void router.navigate({
      to: router.state.location.pathname,
      search: router.state.location.search,
      state: { ...router.state.location.state, __peViewOpenCommandId: undefined },
      replace: true,
      ignoreBlocker: true,
    } as never);
  }, [thread]);

  /** Every move keeps the selected `?thread`; an ordinary move clears an explicit open's id. */
  const navigate = async (
    destination: string,
    id: string | null,
    replace = false,
    command?: string,
  ) => {
    const url = new URL(destination, "http://tab.invalid");
    focus(id);
    await router.navigate({
      to: url.pathname,
      search: {
        ...Object.fromEntries(url.searchParams),
        thread: router.state.location.search.thread,
        shell: surface === "tray" ? "tray" : undefined,
      },
      state: (previous: Record<string, unknown>) => ({
        ...previous,
        __peRouteTab: id ? { id, route: routeAt(url.pathname) ?? undefined } : undefined,
        __peViewOpenCommandId: command,
      }),
      replace,
    } as never);
  };
  /** A real selected chat records the Place it is talking about; drafts and others record nothing. */
  const recordPlace = (owner: string, tabRoute: RouteKey, tabLink: string) => {
    if (!owner || store.local || !threads.some((each) => each.id === owner)) return;
    void peClient
      .call("thread.place", { params: { id: owner }, body: { route: tabRoute, link: tabLink } })
      .catch(fail);
  };
  const select = (tab: ThreadTab, replace = false) => {
    store.actions.cancelPlan();
    return navigate(tab.link, tab.id, replace);
  };
  const open = async <R extends RouteKey>(
    targetRoute: R,
    page?: LinkPage<R>,
    explicit?: Pick<Carry, "target" | "work">,
    duplicate = false,
    keep = false,
  ) => {
    if (targetRoute === "pea") {
      setFailure(`This route has no saved Place contract: ${targetRoute}`);
      return false;
    }
    try {
      const wanted = bindingOf(
        targetRoute,
        routeAddress(targetRoute).link(page, {
          target: explicit !== undefined ? explicit.target : carry.target,
          work: explicit !== undefined ? explicit.work : carry.work,
        }),
      );
      // Reuse only the Place with this exact binding (the `?demo=` fixture keeps one per route).
      const existing =
        !duplicate &&
        read().find(
          (tab) =>
            tab.route === targetRoute &&
            (store.local || bindingOf(targetRoute, tab.link) === wanted),
        );
      const nextLink =
        page === undefined && explicit === undefined && existing
          ? existing.link
          : routeAddress(targetRoute).link(
              keep && existing
                ? ({
                    ...routeAddress(targetRoute).read(params(existing.link)).page,
                    ...page,
                  } as LinkPage<R>)
                : page,
              {
                target: explicit !== undefined ? explicit.target : carry.target,
                work: explicit !== undefined ? explicit.work : carry.work,
              },
            );
      const canonical = routeAddress(targetRoute).tab(nextLink);
      if (!canonical.ok) throw Error(canonical.error);
      const id = existing ? existing.id : crypto.randomUUID();
      put(id, targetRoute, canonical.link);
      await navigate(canonical.link, id);
      return router.state.location.pathname === routeAddress(targetRoute).path;
    } catch (error) {
      fail(error);
      return false;
    }
  };

  // Pea's explicit open, delivered live to the browser showing its conversation. Held even at /pea.
  const realThread = Boolean(thread) && threads.some((each) => each.id === thread);
  const onOpen = useCallback(
    (event: RouteViewOpenIntent) => {
      if (
        event.type !== "route-view-open" ||
        !routeViewOpenSchema.safeParse({ thread: event.thread, link: event.link }).success ||
        !z.uuid().safeParse(event.commandId).success
      )
        return;
      if (event.thread !== router.state.location.search.thread) return;
      const at = routeAddress(event.route as RouteKey);
      const canonical = at.tab(event.link);
      if (!canonical.ok) return;
      const wanted = bindingOf(event.route as RouteKey, canonical.link);
      // The exact binding's Place is focused with its saved Page unchanged (Pea patches only the
      // fields it names next); a new binding opens at the base link's default Page.
      const existing = read().find(
        (tab) => tab.route === event.route && bindingOf(tab.route, tab.link) === wanted,
      );
      void (async () => {
        if (existing) await navigate(existing.link, existing.id, false, event.commandId);
        else {
          const id = crypto.randomUUID();
          put(id, event.route as RouteKey, canonical.link);
          await navigate(canonical.link, id, false, event.commandId);
        }
        recordPlace(event.thread, event.route as RouteKey, canonical.link);
      })().catch(fail);
    },
    [router, thread, threads],
  );
  useHostEvents(realThread && !store.local, onOpen);

  useEffect(
    () =>
      store.actions.connectTabs({
        open,
        // A Work press opens this window's Place holding that Work (its Page and id kept), else a
        // new one at the resumed url. The selected `?thread` stays selected.
        work: async (_owner, workRoute, resumed) => {
          try {
            const saved = read().find((tab) =>
              resumed ? holdsWork(tab, workRoute, resumed) : store.local && tab.route === workRoute,
            );
            const destination = saved
              ? rebased(saved, resumed?.url ?? null)
              : (resumed?.url ?? routeAddress(workRoute as RouteKey).link());
            const id = saved?.id ?? crypto.randomUUID();
            put(id, workRoute as RouteKey, destination);
            store.actions.placeClosedWork(id);
            await navigate(destination, id);
            // The row may belong to another thread: the selected chat stays selected and is the one
            // that learns this Place.
            recordPlace(
              router.state.location.search.thread ?? "",
              workRoute as RouteKey,
              destination,
            );
            focusQuiet(document.querySelector<HTMLElement>('[data-pane-id="tools"]'));
          } catch (error) {
            fail(error);
          }
        },
        // First Send promotes the draft in place: the visible tool stays open and visible.
        promote: async (owner) => {
          await router.navigate({
            to: router.state.location.pathname,
            search: (previous: Record<string, unknown>) => ({ ...previous, thread: owner }),
            state: (previous: Record<string, unknown>) => ({ ...previous }),
            replace: true,
          } as never);
        },
        // A Send while a tool is the current Place names it to that chat.
        sent: (owner) => {
          const at = tabRouteAt(router.state.location.pathname);
          if (at) recordPlace(owner, at, place(at, router.state.location.search, store.local));
        },
      }),
    [store, thread, threads, carry.target, carry.work],
  );

  return {
    thread,
    route,
    tabs,
    active: active?.id ? { thread, id: active.id, route: active.route, link: active.link } : null,
    ready: true,
    target: carry.target,
    failure: legacy
      ? "This old workspace group link is unavailable; open a route and choose its exact subject."
      : failure,
    select: (tab: ThreadTab) => select(tab).catch(fail),
    /** Expand the collapsed tools on the Place this window last showed. */
    resume: () => {
      const last = tabs.find((tab) => tab.id === readFocus()) ?? tabs[0];
      if (last) void select(last).catch(fail);
    },
    chat: () =>
      navigate(
        routeAddress("pea").link({}, { target: carry.target, work: carry.work }),
        null,
      ).catch(fail),
    close: async (tab: Pick<ThreadTab, "id">) => {
      store.actions.cancelPlan();
      try {
        const index = tabs.findIndex((item) => item.id === tab.id);
        const rest = commit(read().filter((item) => item.id !== tab.id));
        if (active?.id === tab.id) {
          const next = rest[Math.min(index, rest.length - 1)];
          await navigate(next?.link ?? routeAddress("pea").link(), next?.id ?? null, true);
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
    retry: () => setFailure(null),
  };
}
