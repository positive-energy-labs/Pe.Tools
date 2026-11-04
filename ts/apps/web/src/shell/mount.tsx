/**
 * The route door: one declaration admits, then mounts one owner. Every noun lives in its seam —
 * page (`mount-page`), panes (`mount-pane`), readings (`mount-reading`), Work (`mount-work`),
 * Timeline (`mount-timeline`), verbs (`mount-verbs`), chrome (`mount-chrome`), owner
 * (`mount-owner`). The mount-seams guard holds this file to seam imports and a line cap.
 */
import type { RouteGraph } from "@pe/agent-contracts";
import { GraphRouteView, Refused } from "./mount-chrome";
import { codeRoute, type CodeRoute } from "./mount-page";
import { admitRoute, type RouteAdapters } from "./mount-pane";
import { GraphLease, useGraphRoute, type MountRouteProps } from "./mount-work";

export type { GraphMount, MountAdapters, MountScope, MountBinding } from "./mount-owner";
export { createGraphMount } from "./mount-owner";
export type { MountBody, RouteAdapters } from "./mount-pane";
export type { MountRouteProps } from "./mount-work";
export { useGraphRoute } from "./mount-work";
export { GraphRouteView } from "./mount-chrome";
export { GraphHistory } from "./mount-timeline";

/** One declaration produces one mounted owner. Admission runs before any owner or resource exists. */
export function mountRoute<P, W>(graph: RouteGraph<P, W>, adapters: RouteAdapters<P, W>) {
  const refusals = admitRoute(graph, adapters);
  if (refusals.length)
    return function RefusedRoute() {
      return <Refused refusals={refusals} />;
    };
  return function MountedRoute(props: MountRouteProps) {
    const mount = useGraphRoute(graph, adapters, props);
    return (
      <>
        {adapters.lease && !mount.owner.commandRefusal && (
          <GraphLease
            graph={graph}
            owner={mount.owner}
            shown={adapters.lease(mount.owner)}
            props={props}
            visible={!mount.hidden}
          />
        )}
        <GraphRouteView graph={graph} adapters={adapters} {...mount} />
      </>
    );
  };
}

/** A code route under the app root; the page seam owns its search validation. */
export function routeFromGraph<P, W, const Path extends string>(
  graph: RouteGraph<P, W>,
  adapters: RouteAdapters<P, W>,
  path: Path = `/${graph.address.replace(/^\//, "")}` as Path,
): CodeRoute<P, Path> {
  return codeRoute(graph, adapters.initialPage, mountRoute(graph, adapters), path);
}
