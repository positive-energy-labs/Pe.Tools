import { describe, expect, it } from "vite-plus/test";

import { censusFromRouteTree } from "./fixture-census";

describe("fixture census", () => {
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
