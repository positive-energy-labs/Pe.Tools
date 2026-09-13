import { expect, test } from "vite-plus/test";

import { createRouteRegistrations } from "../src/pea/routes.ts";

const routes = () =>
  createRouteRegistrations({ hostBaseUrl: "http://127.0.0.1:1" }).map((entry) => entry.spec.route);

/** The registry is authored Work: every route here owns a route-state document an agent can stage. */
test("route registry lists exactly the retained collaborative routes", () => {
  expect([...routes()].sort()).toEqual([
    "families",
    "family",
    "instances",
    "parameter-links",
    "schedule-grid",
    "settings",
    "takeoffs",
  ]);
});

/**
 * Ops is a read-only projection over the action journal and receipt readers, and Family Types was
 * retired. Neither has an authored route-state contract, and neither may reappear in the registry:
 * membership here is what makes a route stageable, so a read-only view listed here would invite
 * staged writes against a document that does not exist.
 */
test("ops and the retired family-types own no authored contract", () => {
  expect(routes()).not.toContain("ops");
  expect(routes()).not.toContain("family-types");
});

/** Collaborative routes without bespoke handlers are still registered, with an empty handler map. */
test("a route needs no bespoke handlers to be collaborative", () => {
  const registrations = createRouteRegistrations({ hostBaseUrl: "http://127.0.0.1:1" });
  const takeoffs = registrations.find((entry) => entry.spec.route === "takeoffs");
  expect(takeoffs).toBeTruthy();
  expect(Object.keys(takeoffs!.handlers ?? {})).toEqual([]);
  // Schedule Grid is host-owned now: it stays collaborative but carries no CLI command handlers.
  const schedule = registrations.find((entry) => entry.spec.route === "schedule-grid");
  expect(Object.keys(schedule!.handlers ?? {})).toEqual([]);
});
