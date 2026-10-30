/**
 * The seed catalogue: every route that declares `graph.seeds`, one row per seed action.
 *
 * There is no second demo lane any more. A seed is plain data beside the route's graph, and
 * `?fixture=<action>` mounts it through the kernel's fixture owner — so this surface's whole job is
 * to name what exists and link to it. It builds nothing, owns nothing, and runs no action.
 */
import type { GraphSeed } from "@pe/agent-contracts";
import { useSyncExternalStore } from "react";
import { publicRoutes } from "#/route/builtin-routes";
import { Demo } from "./exhibit";

interface SeedRow {
  /** The graph key the seed belongs to. */
  route: string;
  /** The route path `?fixture=` is appended to. */
  path: string;
  /** The action key the seed seeds. */
  action: string;
  /** The seed's own one-line title. */
  title: string;
  /** The URL that mounts this seed in an isolated fixture owner. */
  href: string;
}

type AnySeeds = Readonly<Record<string, GraphSeed<unknown, unknown> | undefined>> | undefined;

const rows = (route: string, path: string, seeds: AnySeeds): SeedRow[] =>
  Object.entries(seeds ?? {})
    .filter(([, seed]) => seed !== undefined)
    .map(([action, seed]) => ({
      route,
      path,
      action,
      title: seed!.title,
      href: `${path}?fixture=${encodeURIComponent(action)}`,
    }));

export function ActionDemoCatalogue() {
  useSyncExternalStore(publicRoutes.subscribe, publicRoutes.revision, publicRoutes.revision);
  const SEED_CATALOGUE = publicRoutes
    .entries()
    .flatMap(({ graph }) => (graph ? rows(graph.key, `/${graph.address}`, graph.seeds) : []));
  return (
    <Demo
      label="Seed catalogue"
      consumers="Every route graph that declares seeds"
      spec="A seed is plain data beside the route's graph. Opening its link mounts it through ?fixture= in an isolated owner; nothing here runs an action or touches a host."
    >
      {/* DOMAIN (kept hand table): a specimen page's plain seed index, not a product surface. */}
      <table aria-label="Route seeds">
        <thead>
          <tr>
            <th scope="col">Route</th>
            <th scope="col">Action</th>
            <th scope="col">Seed</th>
          </tr>
        </thead>
        <tbody>
          {SEED_CATALOGUE.map((row) => (
            <tr key={`${row.route}.${row.action}`}>
              <td>{row.route}</td>
              <td>
                <a href={row.href}>{row.action}</a>
              </td>
              <td>{row.title}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {SEED_CATALOGUE.length === 0 && <p role="status">No route declares a seed.</p>}
    </Demo>
  );
}
