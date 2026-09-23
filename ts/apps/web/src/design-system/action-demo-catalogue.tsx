/**
 * The seed catalogue: every route that declares `manifest.seeds`, one row per seed action.
 *
 * There is no second demo lane any more. A seed is plain data on the route's own manifest, and
 * `?demo=<action>` mounts it through `useRoute`'s isolated owner — so this surface's whole job is
 * to name what exists and link to it. It builds nothing, owns nothing, and runs no action.
 */
import type { Seed } from "@pe/agent-contracts";
import { CHAT_SEEDS } from "#/chat/seeds";
import { PODS_SEEDS } from "#/route/seeds";
import { SCHEDULE_SEEDS } from "#/route/schedules/manifest";
import { INSTANCES_SEEDS } from "#/instances/seeds";
import { manifest as takeoffManifest } from "#/takeoff/manifest";
import { manifest as familyManifest } from "#/routes/family";
import { manifest as familiesManifest } from "#/families/manifest";
import { Demo } from "./exhibit";

interface SeedRow {
  /** The manifest key the seed belongs to. */
  route: string;
  /** The route path `?demo=` is appended to. */
  path: string;
  /** The action key the seed seeds. */
  action: string;
  /** The seed's own one-line title. */
  title: string;
  /** The URL that mounts this seed in an isolated demo owner. */
  href: string;
}

type AnySeeds = Readonly<Record<string, Seed<unknown, string, unknown> | undefined>> | undefined;

const rows = (route: string, path: string, seeds: AnySeeds): SeedRow[] =>
  Object.entries(seeds ?? {})
    .filter(([, seed]) => seed !== undefined)
    .map(([action, seed]) => ({
      route,
      path,
      action,
      title: seed!.title,
      href: `${path}?demo=${encodeURIComponent(action)}`,
    }));

/**
 * Chat and Schedules declare their manifests as builders over live deps, so their seed records are
 * read straight from the seed modules the builders hand to `seeds:`. Same data, no deps needed.
 */
export const SEED_CATALOGUE: SeedRow[] = [
  ...rows("chat", "/chat", CHAT_SEEDS as AnySeeds),
  ...rows("pods", "/pods", PODS_SEEDS as AnySeeds),
  ...rows("schedules", "/schedules", SCHEDULE_SEEDS as AnySeeds),
  ...rows("instances", "/instances", INSTANCES_SEEDS as AnySeeds),
  ...rows("takeoffs", "/takeoffs", takeoffManifest.seeds as AnySeeds),
  ...rows("family", "/family", familyManifest.seeds as AnySeeds),
  ...rows("families", "/families", familiesManifest.seeds as AnySeeds),
];

export function ActionDemoCatalogue() {
  return (
    <Demo
      label="Seed catalogue"
      consumers="Every route manifest that declares seeds"
      spec="A seed is plain data on the route's manifest. Opening its link mounts it through ?demo= in an isolated owner; nothing here runs an action or touches a host."
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
