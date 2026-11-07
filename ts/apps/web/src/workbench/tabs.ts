import { subjectState, useSubjects } from "../shell/subject";
import { commitAddress, rawQuery, restorePageSearch, tabPageSearch } from "../route/url";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { z } from "zod";
import { useRouter, useRouterState } from "@tanstack/react-router";
import {
  routeAddress,
  canonicalPlace,
  routeViewOpenedSchema,
  THREAD_TABS_MAX,
  threadTabSchema,
  routeOf,
  routeAt,
  placeCarry,
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
import { useHostEvents } from "#/host/resource-stream";
import { useSurfaceHost } from "#/navigation/surface-host";
import type { Resumed } from "#/chat/thread-work";
import { useWorkbench } from "./provider";
import { publicRoutes } from "#/route/route-discovery";
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
  } catch (error) {
    console.warn("ts/apps/web/src/workbench/tabs.ts: fallback after failure", error);
    /* This window keeps its mounted Places. */
  }
};
const readFocus = () => {
  try {
    return sessionStorage.getItem(FOCUS);
  } catch (error) {
    console.warn("ts/apps/web/src/workbench/tabs.ts: fallback after failure", error);
    return null;
  }
};
const focus = (id: string | null) => {
  try {
    if (id) sessionStorage.setItem(FOCUS, id);
    else sessionStorage.removeItem(FOCUS);
  } catch (error) {
    console.warn("ts/apps/web/src/workbench/tabs.ts: fallback after failure", error);
    /* The URL still owns the Place. */
  }
};

/** Only registered shareable fields and an explicit target/work survive in a Place. */
function place(route: RouteKey, search: Record<string, unknown>, local: boolean) {
  const { page, carry } = routeAddress(route).read(search);
  const link = routeAddress(route).link(page, { target: carry.target, work: carry.work });
  // A `?fixture=` seed rides its fixture Place.
  return local && typeof search.fixture === "string"
    ? `${link}${link.includes("?") ? "&" : "?"}fixture=${encodeURIComponent(search.fixture)}`
    : link;
}

const params = (link: string) =>
  Object.fromEntries(new URL(link, "http://tab.invalid").searchParams);

// Registration is read live; retired Places remain evidence but cannot be selected.
const canonical = (route: string, link: string) =>
  canonicalPlace(route, link, publicRoutes.declaration(route)?.address);
const admitted = (route: string) => publicRoutes.declaration(route) !== null;
function unowned(route: string, raw: string, search: Record<string, unknown>, local: boolean) {
  const builtin = routeOf(route);
  if (builtin && !admitted(route)) return place(builtin, search, local);
  const query = new URLSearchParams(raw);
  query.delete("thread");
  query.delete("shell");
  const path = publicRoutes.declaration(route)?.address;
  return path ? `${path}${query.size ? `?${query}` : ""}` : null;
}

/** A matched Place keeps its Page and id and takes the resume's stable binding. */
function rebased(tab: ThreadTab, url: string | null): string {
  if (!url) return tab.link;
  const target = placeCarry(tab.route, url).target;
  const query = new URL(tab.link, "http://tab.invalid");
  if (target === undefined) query.searchParams.delete("target");
  else query.searchParams.set("target", target);
  return `${query.pathname}${query.search}`;
}

/** Reuse only an exact target/work binding; published Pages also bind their page id. */
const bindingOf = (route: string, link: string) => {
  const { target, work } = placeCarry(route, link);
  const page = route === "bind" ? routeAddress("bind").read(params(link)).page.page : null;
  return JSON.stringify([target ?? null, work ?? null, page]);
};

const sameRef = (a: DocumentRef, b: DocumentRef) =>
  a.session === b.session && a.openId === b.openId;

/** Work key semantics: the Place names the same workspace, Address (or a known exact lifetime of
 *  it), or exact open document as the resumed Work. No route-only guess. */
function holdsWork(tab: ThreadTab, route: string, resumed: Resumed): boolean {
  const key = resumed.key;
  if (tab.route !== route || !key) return false;
  const { target: raw, work } = placeCarry(tab.route, tab.link);
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
  if (pathname === routeAddress("pea").path) return null;
  const route = publicRoutes.byAddress(pathname)?.manifest.key ?? routeAt(pathname);
  return route === "pea" ? null : route;
};

type TabHistory = {
  __peRouteTab?: { id: string; route: string };
  /** The explicit Pea open this Place answers; page-local, never in the URL or a Place link. */
  __peViewOpenCommandId?: string;
};
const historyOf = (state: unknown) => (state ?? {}) as TabHistory;

/** This window's Places, and the moves between them; the selected `?thread` rides along unchanged. */
export function useRouteTabs() {
  const { store, threads } = useWorkbench();
  useSyncExternalStore(publicRoutes.subscribe, publicRoutes.revision, publicRoutes.revision);
  const router = useRouter();
  const surface = useSurfaceHost().surface;
  const location = useRouterState({ select: (state) => state.location });
  const thread = location.search.thread ?? "";
  const legacy =
    location.pathname === "/pea" &&
    ["plugin", "focus"].some((key) => new URLSearchParams(location.searchStr).has(key));
  const route = tabRouteAt(location.pathname);
  const carry = placeCarry(route ?? "pea", `${location.pathname}?${rawQuery(router)}`);
  useSubjects();
  const explicit = new Set(new URLSearchParams(location.searchStr).keys());
  const search =
    restorePageSearch(
      "__pePageMove" in location.state || "__peRouteTab" in location.state
        ? undefined
        : tabPageSearch(location.pathname),
      Object.fromEntries(Object.entries(location.search).filter(([key]) => explicit.has(key))),
    ) ?? {};
  // Admitted codecs consume raw history text; router JSON parsing is not their decoder.
  const subject = subjectState(route ?? "", Object.fromEntries(rawQuery(router)));
  const link =
    subject.link !== undefined
      ? subject.link
      : route
        ? unowned(route, String(rawQuery(router)), search, store.local)
        : null;
  const restoring = Object.keys(search).some((key) => !(key in location.search));
  const [tabs, setTabs] = useState<ThreadTab[]>(read);
  const [failure, setFailure] = useState<string | null>(null);
  const fail = (error: unknown) =>
    setFailure(error instanceof Error ? error.message : String(error));
  const commit = (next: ThreadTab[]) => {
    save(next);
    setTabs(next);
    return next;
  };
  const put = (id: string, tabRoute: string, tabLink: string) => {
    const checked = canonical(tabRoute, tabLink);
    if (!checked.ok) throw Error(checked.error);
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
            // A deep link arriving from another Place (a /ducts row opening /fans) reuses this
            // route's Place with the same binding; minting one drew a duplicate tab (Manual D).
            tabs.find(
              (tab) => tab.route === route && bindingOf(route, tab.link) === bindingOf(route, link),
            )?.id ??
            null,
          route,
          link,
        }
      : null;

  // The visible tool is a Place: record its current link and tag history with its id.
  useEffect(() => {
    if (!active || restoring) return;
    // Restoring an existing exact Place is navigation, not a new subject/native admission.
    const known = read().some((tab) => tab.id === active.id && tab.link === active.link);
    const builtin = routeOf(active.route);
    if (
      subject.refusal ||
      (!subject.ready &&
        (!known ||
          (builtin &&
            !admitted(active.route) &&
            routeAddress(builtin).read(search).problems.length)))
    )
      return;
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
        void commitAddress(router, location.pathname, rawQuery(router), {
          state: { ...location.state, __peRouteTab: { id, route: active.route } },
          replace: true,
          ignoreBlocker: true,
        });
    } catch (error) {
      fail(error);
    }
  }, [
    active?.id,
    active?.link,
    active?.route,
    tagged?.id,
    tagged?.route,
    restoring,
    subject.ready,
    subject.refusal,
  ]);

  // The command id names the last explicit open this Place rendered for its conversation; it
  // survives same-Place Page moves but not a change of the thread association.
  const lastThread = useRef(thread);
  useEffect(() => {
    if (lastThread.current === thread) return;
    lastThread.current = thread;
    const at = router.state.location;
    if (!historyOf(at.state).__peViewOpenCommandId) return;
    void commitAddress(router, at.pathname, rawQuery(router), {
      state: { ...at.state, __peViewOpenCommandId: undefined },
      replace: true,
      ignoreBlocker: true,
    });
  }, [thread]);

  /** Every move keeps the selected `?thread`; an ordinary move clears an explicit open's id. */
  const navigate = async (
    destination: string,
    id: string | null,
    replace = false,
    command?: string,
  ) => {
    const key =
      read().find((tab) => tab.id === id)?.route ??
      tabRouteAt(new URL(destination, "http://tab.invalid").pathname);
    if (key && !canonical(key, destination).ok) throw Error(`Route ${key} is unavailable`);
    const url = new URL(destination, "http://tab.invalid");
    focus(id);
    // A Place is its own scope: its link's bytes are the Page, with no root carry retention.
    const query = url.searchParams;
    const thread = rawQuery(router).get("thread");
    query.delete("thread");
    if (thread) query.set("thread", thread);
    query.delete("shell");
    if (surface === "tray") query.set("shell", "tray");
    await commitAddress(router, url.pathname, query, {
      state: {
        ...router.state.location.state,
        __peRouteTab: id ? { id, route: tabRouteAt(url.pathname) ?? undefined } : undefined,
        __peViewOpenCommandId: command,
      },
      replace,
    });
  };
  /** A real selected chat records the Place it is talking about; drafts and others record nothing. */
  const recordPlace = (owner: string, tabRoute: string, tabLink: string) => {
    if (!owner || store.local || !threads.some((each) => each.id === owner)) return;
    void peClient
      .call("thread.place", { params: { id: owner }, body: { route: tabRoute, link: tabLink } })
      .catch(fail);
  };
  const select = (tab: ThreadTab, replace = false) => {
    store.actions.cancelPlan();
    const checked = canonical(tab.route, tab.link);
    if (!checked.ok) return Promise.reject(Error(checked.error));
    return navigate(checked.link, tab.id, replace);
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
      const at = routeAddress(targetRoute);
      const binding = explicit ?? { target: carry.target, work: carry.work };
      const wanted = bindingOf(targetRoute, at.link(page, binding));
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
          : at.link(
              keep && existing
                ? ({ ...at.read(params(existing.link)).page, ...page } as LinkPage<R>)
                : page,
              binding,
            );
      const checked = canonical(targetRoute, nextLink);
      if (!checked.ok) throw Error(checked.error);
      const id = existing ? existing.id : crypto.randomUUID();
      put(id, targetRoute, checked.link);
      await navigate(checked.link, id);
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
        !routeViewOpenedSchema.safeParse({ thread: event.thread, link: event.link }).success ||
        !z.uuid().safeParse(event.commandId).success
      )
        return;
      if (event.thread !== router.state.location.search.thread) return;
      const checked = canonical(event.route, event.link);
      if (!checked.ok) return;
      const wanted = bindingOf(event.route, checked.link);
      // The exact binding's Place is focused with its saved Page unchanged (Pea patches only the
      // fields it names next); a new binding opens at the base link's default Page.
      const existing = read().find(
        (tab) => tab.route === event.route && bindingOf(tab.route, tab.link) === wanted,
      );
      void (async () => {
        if (existing) await navigate(existing.link, existing.id, false, event.commandId);
        else {
          const id = crypto.randomUUID();
          put(id, event.route, checked.link);
          await navigate(checked.link, id, false, event.commandId);
        }
        recordPlace(event.thread, event.route, checked.link);
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
              : (resumed?.url ??
                publicRoutes.declaration(workRoute)?.address ??
                (routeOf(workRoute) ? routeAddress(routeOf(workRoute)!).link() : ""));
            const id = saved?.id ?? crypto.randomUUID();
            const checked = canonical(workRoute, destination);
            if (!checked.ok) throw Error(checked.error);
            put(id, workRoute, checked.link);
            store.actions.placeClosedWork(id);
            await navigate(destination, id);
            // The row may belong to another thread: the selected chat stays selected and is the one
            // that learns this Place.
            recordPlace(router.state.location.search.thread ?? "", workRoute, destination);
            focusQuiet(document.querySelector<HTMLElement>('[data-pane-id="tools"]'));
          } catch (error) {
            fail(error);
          }
        },
        // First Send promotes the draft in place: the visible tool stays open and visible.
        promote: async (owner) => {
          const at = router.state.location;
          const query = rawQuery(router);
          query.set("thread", owner);
          await commitAddress(router, at.pathname, query, {
            state: { ...at.state },
            replace: true,
          });
        },
        // A Send while a tool is the current Place names it to that chat.
        sent: (owner) => {
          const at = tabRouteAt(router.state.location.pathname);
          const owned = at && subjectState(at, params(router.state.location.href)).link;
          const link = !at
            ? null
            : owned !== undefined
              ? owned
              : unowned(at, String(rawQuery(router)), router.state.location.search, store.local);
          if (at && link) recordPlace(owner, at, link);
        },
      }),
    [store, thread, threads, carry.target, carry.work],
  );

  return {
    thread,
    route,
    tabs,
    // Addressed identity survives subject-reading gaps; active also requires a usable Page.
    placeId: tagged?.route === route && tabs.some((tab) => tab.id === tagged.id)
      ? tagged.id
      : active?.id ?? null,
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
      if (!active) return;
      try {
        const id = crypto.randomUUID();
        put(id, active.route, active.link);
        await navigate(active.link, id);
      } catch (error) {
        fail(error);
      }
    },
    retry: () => setFailure(null),
  };
}
