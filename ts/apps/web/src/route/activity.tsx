import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { deepEqual, useRouter } from "@tanstack/react-router";
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

/** Unlike Activity's retained UI state, heavyweight resource owners must leave the hidden tree. */
export const RouteVisibility = createContext(true);
export function VisibleRouteResource({ children }: { children: ReactNode }) {
  return useContext(RouteVisibility) ? children : null;
}

const decoded = new WeakMap<object, Map<RouteKey | undefined, Record<string, unknown> & Carry>>();
function searchOf(search: Record<string, unknown>, route?: RouteKey) {
  let pages = decoded.get(search);
  if (!pages) decoded.set(search, (pages = new Map()));
  let page = pages.get(route);
  if (!page) {
    const read = routeAddress(route ?? "pea").read(search);
    page = {
      ...(route ? read.page : search),
      target: undefined,
      work: undefined,
      thread: undefined,
      ...read.carry,
    };
    pages.set(route, page);
  }
  return page;
}

/** A URL publication wakes only readers whose selected fields changed, including retained tabs. */
export function useRouteSearchSlice<S>(select: (search: Record<string, unknown> & Carry) => S): S {
  const scope = useRouteActivity();
  const router = useRouter({ warn: false });
  const raw = typeof location === "undefined" ? "" : location.search;
  const fallback = useMemo(() => Object.fromEntries(new URLSearchParams(raw)), [raw]);
  const selector = useRef(select);
  selector.current = select;
  const held = useRef<{ value: S } | undefined>(undefined);
  const subscribe = useCallback(
    (notify: () => void) => (router ? router.subscribe("onResolved", notify) : () => {}),
    [router],
  );
  const snapshot = useCallback(() => {
    const search =
      scope && !scope.current()
        ? scope.search
        : (router?.state.location.search ?? scope?.search ?? fallback);
    const value = selector.current(searchOf(search));
    if (held.current && deepEqual(held.current.value, value, { ignoreUndefined: false }))
      return held.current.value;
    held.current = { value };
    return value;
  }, [router, scope, fallback]);
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}

/** Route descendants read their own captured search even when Activity renders them hidden. */
export function useRouteSearch<R extends RouteKey>(route: R): UrlPage<R> & Carry;
export function useRouteSearch(): Record<string, unknown> & Carry;
export function useRouteSearch(route?: RouteKey) {
  return useRouteSearchSlice((search) => (route ? searchOf(search, route) : search));
}

export function useRouteFixture(): string | null {
  return useRouteSearchSlice((search) =>
    typeof search.fixture === "string" ? search.fixture : null,
  );
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
