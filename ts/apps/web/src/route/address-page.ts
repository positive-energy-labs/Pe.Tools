/**
 * A route with an address and no manifest (Home, Settings, Ops, Bind, Captures) still gets the
 * same Page owner, history rule and agent lease as one with Work: `routeFile(route)` is its file
 * route's search options, `useAddressPage(route)` its Page. The address schema is the Page; the
 * URL, Back/Forward and Pea's patch all move it through `routeAddress(route).transition`, exactly
 * as `useRoute` does for a manifest route.
 */
import {
  routeAddress,
  type RouteKey,
  type RoutePage,
  type RouteViewRoute,
} from "@pe/agent-contracts";
import type { SearchSchemaInput } from "@tanstack/react-router";
import type { z } from "zod";
import type { PageMove } from "./manifest";
import {
  appAtomRegistry,
  createRouteOwner,
  routeSearch,
  useOwned,
  useRouteOwner,
} from "./route-owner";
import { routeUrlPage, useInitialUrlPage, useUrlPage } from "./url";
import { createViewOwner } from "./view-owner";
import { useRouteSearch } from "./activity";
import { useRouteViewBridge } from "./view-bridge";

/**
 * `createFileRoute(path)({ ...routeFile(route), component })`: the address is the search. Its
 * input is `SearchSchemaInput`, which is what lets a `<Link to="/settings">` omit every key.
 */
export function routeFile<R extends RouteKey>(route: R) {
  const url = routeUrlPage(route);
  return {
    validateSearch: (search: SearchSchemaInput & Record<string, unknown>) => ({
      ...routeSearch(search),
      ...routeAddress(route).read(search).page,
    }),
    search: { middlewares: [...url.middlewares] },
  };
}

export type AddressPage<R extends RouteKey> = readonly [
  RoutePage<R>,
  (next: Partial<RoutePage<R>>, move?: PageMove<RoutePage<R>>) => void,
];

/** The Page of a route that is only its address; it is the one writer of the address bar. */
export function useAddressPage<R extends RouteKey>(route: R): AddressPage<R> {
  const url = routeUrlPage(route);
  const initial = useInitialUrlPage(url);
  const owner = useRouteOwner(() => {
    const base = createRouteOwner(route, appAtomRegistry);
    const view = createViewOwner(
      base,
      routeAddress(route).schema as unknown as z.ZodType<RoutePage<R>>,
      initial,
      { address: route },
    );
    return {
      ...base,
      view,
      dispose: () => {
        view.dispose();
        base.dispose();
      },
    };
  });
  const snapshot = useOwned(owner.registry, owner.view.state)!;
  useUrlPage(url, owner.view);
  return [snapshot.page, owner.view.setPage];
}

/**
 * Leases the route's mounted Page to Pea when a thread addresses it (a thread tab, or a link that
 * carries `thread`); with none, nobody could name this view, so nothing is published. `page` is
 * the Page the owner holds (`useAddressPage`, or a manifest route's `handle.page`): the bridge
 * acknowledges only a patch that Page's owner accepted. A Pea patch is one pushed move.
 */
export function useRouteLease<R extends RouteViewRoute, P extends object>(
  route: R,
  [page, setPage]: readonly [P, (next: Partial<P>, move?: PageMove<P>) => void],
  shown: {
    visible?: boolean;
    /** Identity of what is shown; an ack fails if it moves while a command is pending. */
    context?: Record<string, unknown>;
    /** What the shown Page derives; Pea reads it, never sets it. */
    facts?: Record<string, unknown>;
  } = {},
) {
  const { thread } = useRouteSearch();
  useRouteViewBridge({
    route,
    thread,
    surface: "route",
    visible: shown.visible ?? true,
    page,
    apply: (patch) => setPage(patch as Partial<P>, { history: "push" }),
    context: shown.context ?? {},
    facts: shown.facts ?? {},
  });
}
