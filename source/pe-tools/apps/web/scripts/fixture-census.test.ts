import { readFileSync } from "node:fs";
import { describe, expect, it } from "vite-plus/test";

import { censusFromRouteTree } from "./fixture-census";

describe("fixture census", () => {
  it("admits every maintained route in the generated route tree", () => {
    const routeTree = readFileSync(new URL("../src/routeTree.gen.ts", import.meta.url), "utf8");
    const census = censusFromRouteTree(routeTree);

    for (const route of [
      "/chat",
      "/instances",
      "/ops",
      "/parameter-links",
      "/runs",
      "/schedule-grid",
    ]) {
      expect(census.classifiedMaintainedRoutes).toContainEqual({
        route,
        canonicalReviewUrl: `${route}?source=fixture`,
        fixtureKind: "query-fixture",
      });
    }
    expect(census.missingCanonicalFixtures).toBe(0);
  });

  it("reports a newly mounted maintained route as missing debt", () => {
    const census = censusFromRouteTree(`
      fullPath: "/thing-proto";
      fullPath: "/new-product";
      fullPath: "/design-system/example";
      fullPath: "/api/example";
      fullPath: "/";
    `);

    expect(census.discoveredRenderedRoutes).toEqual([
      "/",
      "/design-system/example",
      "/new-product",
      "/thing-proto",
    ]);
    expect(census.classifiedMaintainedRoutes).toContainEqual({
      route: "/new-product",
      canonicalReviewUrl: null,
      fixtureKind: "missing",
    });
    expect(census.discoveredApiRoutes).toEqual(["/api/example"]);
    expect(census.missingCanonicalFixtures).toBe(1);
  });
});
