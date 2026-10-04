import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

type FixtureKind = "demo-fixture" | "inherent-static" | "live-route";

const canonicalFixtures: Record<
  string,
  { canonicalReviewUrl: string; fixtureKind: FixtureKind } | undefined
> = {
  "/": { canonicalReviewUrl: "/", fixtureKind: "inherent-static" },
  "/chat": { canonicalReviewUrl: "/chat?demo=diagram", fixtureKind: "demo-fixture" },
  "/data-tables": { canonicalReviewUrl: "/data-tables", fixtureKind: "live-route" },
  "/doc-lab": { canonicalReviewUrl: "/doc-lab", fixtureKind: "inherent-static" },
  "/families": { canonicalReviewUrl: "/families?demo=apply", fixtureKind: "demo-fixture" },
  "/family": { canonicalReviewUrl: "/family?demo=apply", fixtureKind: "demo-fixture" },
  "/grilles": { canonicalReviewUrl: "/grilles", fixtureKind: "inherent-static" },
  "/instances": { canonicalReviewUrl: "/instances?demo=refresh", fixtureKind: "demo-fixture" },
  "/ops": { canonicalReviewUrl: "/ops", fixtureKind: "live-route" },
  "/parameter-links": { canonicalReviewUrl: "/parameter-links", fixtureKind: "live-route" },
  "/rooms": { canonicalReviewUrl: "/rooms", fixtureKind: "live-route" },
  "/pods": { canonicalReviewUrl: "/pods?demo=browse", fixtureKind: "demo-fixture" },
  "/schedules": { canonicalReviewUrl: "/schedules?demo=apply", fixtureKind: "demo-fixture" },
  "/settings": { canonicalReviewUrl: "/settings", fixtureKind: "live-route" },
  "/takeoffs": { canonicalReviewUrl: "/takeoffs?demo=sync", fixtureKind: "demo-fixture" },
} as const;

const explicitPrototypeRoutes = new Set(["/lab", "/param-tables"]);
const compare = (left: string, right: string) => (left < right ? -1 : left > right ? 1 : 0);

export function censusFromRouteTree(routeTree: string) {
  const discovered = [...routeTree.matchAll(/fullPath:\s*["']([^"']+)["'];/g)].map(
    (match) => match[1]!,
  );
  if (discovered.length === 0) throw new Error("routeTree.gen.ts contains no fullPath metadata");
  if (new Set(discovered).size !== discovered.length)
    throw new Error("routeTree.gen.ts contains duplicate fullPath metadata");

  const routes = discovered.sort(compare);
  const discoveredApiRoutes = routes.filter(
    (route) => route === "/api" || route.startsWith("/api/"),
  );
  const discoveredRenderedRoutes = routes.filter(
    (route) => route !== "/api" && !route.startsWith("/api/"),
  );
  const prototypeRoutes = discoveredRenderedRoutes.filter(
    (route) => route.includes("-proto") || explicitPrototypeRoutes.has(route),
  );
  const designSystemRoutes = discoveredRenderedRoutes.filter(
    (route) => route === "/design-system" || route.startsWith("/design-system/"),
  );
  const maintainedRoutes = discoveredRenderedRoutes.filter(
    (route) => !prototypeRoutes.includes(route) && !designSystemRoutes.includes(route),
  );
  const classifiedMaintainedRoutes = maintainedRoutes.map((route) => ({
    route,
    ...(canonicalFixtures[route] ?? {
      canonicalReviewUrl: null,
      fixtureKind: "missing",
    }),
  }));
  const missingReviewUrls = classifiedMaintainedRoutes.filter(
    ({ fixtureKind }) => fixtureKind === "missing",
  );
  const nonFixtureLiveRoutes = classifiedMaintainedRoutes.filter(
    ({ fixtureKind }) => fixtureKind === "live-route",
  );

  return {
    schemaVersion: 1,
    discoveredRenderedRoutes,
    discoveredApiRoutes,
    classifiedMaintainedRoutes,
    missingReviewUrls,
    nonFixtureLiveRoutes,
    classifiedPrototypeRoutes: prototypeRoutes.map((route) => ({
      route,
      canonicalReviewUrl: route,
      fixtureKind: "prototype-fixture",
    })),
    classifiedDesignSystemSpecimenRoutes: designSystemRoutes.map((route) => ({
      route,
      canonicalReviewUrl: route,
      fixtureKind: "design-system-specimen",
    })),
    missingCanonicalFixtures: missingReviewUrls.length + nonFixtureLiveRoutes.length,
  };
}

const scriptPath = fileURLToPath(import.meta.url);
if (process.argv[1] && resolve(process.argv[1]) === scriptPath) {
  const routeTree = readFileSync(new URL("../src/routeTree.gen.ts", import.meta.url), "utf8");
  console.log(JSON.stringify(censusFromRouteTree(routeTree), null, 2));
}
