/** Retained declaration metadata only; Phase 2 retires the atlas fixture links together. */
import { useSyncExternalStore } from "react";
import { publicRoutes } from "#/route/route-discovery";
import { Demo } from "./exhibit";
import { retainedFixtureCatalogue } from "./retained-fixture-catalogue";

export function ActionDemoCatalogue() {
  useSyncExternalStore(publicRoutes.subscribe, publicRoutes.revision, publicRoutes.revision);
  const SEED_CATALOGUE = retainedFixtureCatalogue.filter(row => publicRoutes.typed(row.route) !== null);
  return (
    <Demo
      label="Seed catalogue"
      consumers="Retained route fixture declarations"
      spec="Retained fixture links from the route declarations. This catalogue runs no action and touches no host."
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
