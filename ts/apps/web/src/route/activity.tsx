import { createContext, useCallback, useContext, useMemo, useSyncExternalStore } from "react";
import { useRouter } from "@tanstack/react-router";
import { routeAddress, type Carry, type RouteKey, type UrlPage } from "@pe/agent-contracts";

type Disposable = { dispose(): void };

/** A retained tree owns local state, but only the addressed tab may affect the outside world. */
export interface RouteActivityScope {
  pathname: string;
  search: Record<string, unknown>;
  readonly current: () => boolean;
  retain(owner: Disposable): void;
  retire(owner: Disposable): void;
}

export const RouteActivity = createContext<RouteActivityScope | null>(null);
export const useRouteActivity = () => useContext(RouteActivity);

/** Route descendants read their own captured search even when Activity renders them hidden. */
export function useRouteSearch<R extends RouteKey>(route: R): UrlPage<R> & Carry;
export function useRouteSearch(): Record<string, unknown> & Carry;
export function useRouteSearch(route?: RouteKey) {
  const scope = useRouteActivity();
  const router = useRouter({ warn: false });
  const raw = typeof location === "undefined" ? "" : location.search;
  const fallback = useMemo(() => Object.fromEntries(new URLSearchParams(raw)), [raw]);
  const subscribe = useCallback(
    (notify: () => void) => (router && !scope ? router.subscribe("onResolved", notify) : () => {}),
    [router, scope],
  );
  const live = useSyncExternalStore(
    subscribe,
    () => scope?.search ?? router?.state.location.search ?? fallback,
    () => scope?.search ?? router?.state.location.search ?? fallback,
  );
  const search = scope?.search ?? live;
  const read = routeAddress(route ?? "pea").read(search);
  // Router location is raw search; useSearch used to supply root-validated carry fields.
  return {
    ...(route ? read.page : search),
    target: undefined,
    work: undefined,
    thread: undefined,
    ...read.carry,
  };
}

export function useRouteDemo(): string | null {
  const search = useRouteSearch();
  return search.live !== undefined ? null : typeof search.demo === "string" ? search.demo : null;
}

/** Retained callbacks can outlive the effect that installed them. Check custody when invoked. */
export function useRouteCurrent(): () => boolean {
  const scope = useRouteActivity();
  return scope?.current ?? alwaysCurrent;
}
const alwaysCurrent = () => true;

export function useRouteNavigate() {
  const router = useRouter();
  const current = useRouteCurrent();
  return useCallback(
    ((options: Parameters<typeof router.navigate>[0]) =>
      current() ? router.navigate(options) : Promise.resolve()) as typeof router.navigate,
    [router, current],
  );
}
