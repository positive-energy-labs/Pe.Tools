import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const canonicalFixtures: Record<
  string,
  { canonicalReviewUrl: string; fixtureKind: "inherent-static" | "query-fixture" } | undefined
> = {
  "/": { canonicalReviewUrl: "/", fixtureKind: "inherent-static" },
  "/data-tables": {
    canonicalReviewUrl: "/data-tables?source=fixture",
    fixtureKind: "query-fixture",
  },
  "/doc-lab": { canonicalReviewUrl: "/doc-lab?source=fixture", fixtureKind: "query-fixture" },
  "/families": { canonicalReviewUrl: "/families?source=fixture", fixtureKind: "query-fixture" },
  "/family": { canonicalReviewUrl: "/family?source=fixture", fixtureKind: "query-fixture" },
  "/grilles": { canonicalReviewUrl: "/grilles", fixtureKind: "inherent-static" },
  "/settings": { canonicalReviewUrl: "/settings?source=fixture", fixtureKind: "query-fixture" },
  "/takeoffs": {
    canonicalReviewUrl: "/takeoffs?source=fixture",
    fixtureKind: "query-fixture",
  },
} as const;

const explicitPrototypeRoutes = new Set(["/param-tables"]);
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

  return {
    schemaVersion: 1,
    discoveredRenderedRoutes,
    discoveredApiRoutes,
    classifiedMaintainedRoutes,
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
    missingCanonicalFixtures: classifiedMaintainedRoutes.filter(
      ({ fixtureKind }) => fixtureKind === "missing",
    ).length,
  };
}

const scriptPath = fileURLToPath(import.meta.url);
if (process.argv[1] && resolve(process.argv[1]) === scriptPath) {
  const routeTree = readFileSync(new URL("../src/routeTree.gen.ts", import.meta.url), "utf8");
  console.log(JSON.stringify(censusFromRouteTree(routeTree), null, 2));
}
