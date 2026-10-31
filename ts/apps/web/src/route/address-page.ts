/**
 * A route with an address and no manifest (Home, Settings, Ops, Bind, Captures) still gets the
 * same Page owner, history rule and agent lease (`useRouteLease`) as one with Work:
 * `routeFile(route)` is its file route's search options, `useAddressPage(route)` its Page. The
 * address schema is the Page; the URL, Back/Forward and Pea's patch all move it through
 * `routeAddress(route).transition`, exactly as `useRoute` does for a manifest route.
 */
import { routeAddress, type RouteKey, type RoutePage } from "@pe/agent-contracts";
import type { SearchSchemaInput } from "@tanstack/react-router";
import type { z } from "zod";
import type { PageMove } from "#/shell/page";
import {
  appAtomRegistry,
  createRouteOwner,
  routeSearch,
  useOwned,
  useRouteOwner,
} from "#/shell/owner";
import { routeUrlPage, useInitialUrlPage, useUrlPage } from "./url";
import { createViewOwner } from "./view-owner";

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
