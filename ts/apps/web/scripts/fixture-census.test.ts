import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vite-plus/test";

import { CHAT_SEEDS } from "../src/chat/seeds";
import { manifest as familiesManifest } from "../src/families/manifest";
import { familyManifest } from "../src/family/manifest";
import { INSTANCES_SEEDS } from "../src/instances/seeds";
import { PODS_SEEDS } from "../src/route/seeds";
import { SCHEDULE_SEEDS } from "../src/route/schedules/manifest";
import { takeoffSeeds } from "../src/takeoff/actions";
import { censusFromRouteTree } from "./fixture-census";

const sourceFiles = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    return entry.isDirectory() ? sourceFiles(path) : /\.[jt]sx?$/.test(entry.name) ? [path] : [];
  });

describe("fixture census", () => {
  it("admits every maintained route in the generated route tree", () => {
    const routeTree = readFileSync(new URL("../src/routeTree.gen.ts", import.meta.url), "utf8");
    const census = censusFromRouteTree(routeTree);

    expect(census.classifiedMaintainedRoutes).toContainEqual({
      route: "/parameter-links",
      canonicalReviewUrl: "/parameter-links",
      fixtureKind: "live-route",
    });
    expect(census.nonFixtureLiveRoutes.map(({ route }) => route)).toEqual([
      "/data-tables",
      "/ops",
      "/parameter-links",
      "/rooms",
    ]);
    expect(census.classifiedPrototypeRoutes).toContainEqual({
      route: "/lab",
      canonicalReviewUrl: "/lab",
      fixtureKind: "prototype-fixture",
    });
    expect(census.missingReviewUrls).toEqual([]);
    expect(census.missingCanonicalFixtures).toBe(4);
  });

  it("uses real manifest seed names for every demo review URL", () => {
    const routeTree = readFileSync(new URL("../src/routeTree.gen.ts", import.meta.url), "utf8");
    const census = censusFromRouteTree(routeTree);
    const seeds = {
      "/chat": CHAT_SEEDS,
      "/families": familiesManifest.seeds,
      "/family": familyManifest().seeds,
      "/instances": INSTANCES_SEEDS,
      "/pods": PODS_SEEDS,
      "/schedules": SCHEDULE_SEEDS,
      "/takeoffs": takeoffSeeds,
    };

    for (const [route, manifestSeeds] of Object.entries(seeds)) {
      const entry = census.classifiedMaintainedRoutes.find(
        (candidate) => candidate.route === route,
      );
      const demo = entry?.canonicalReviewUrl
        ? new URL(entry.canonicalReviewUrl, "https://pe.local").searchParams.get("demo")
        : null;
      expect(entry?.fixtureKind).toBe("demo-fixture");
      expect(demo).toBeTruthy();
      expect(Object.hasOwn(manifestSeeds ?? {}, demo!)).toBe(true);
    }

    for (const entry of census.classifiedMaintainedRoutes)
      expect(
        new URL(entry.canonicalReviewUrl ?? "/", "https://pe.local").searchParams.has("source"),
      ).toBe(false);
  });

  it("does not emit retired fixture-source links", () => {
    const src = fileURLToPath(new URL("../src/", import.meta.url));
    const stale = sourceFiles(src).flatMap((path) =>
      [
        ...readFileSync(path, "utf8").matchAll(/href\s*=\s*["']([^"']*source=fixture[^"']*)["']/g),
      ].map((match) => `${path}:${match[1]}`),
    );
    expect(stale).toEqual([]);
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
    expect(census.missingReviewUrls).toHaveLength(1);
    expect(census.missingCanonicalFixtures).toBe(1);
  });
});
