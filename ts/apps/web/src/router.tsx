import {
  createRouter as createTanStackRouter,
  Link,
  type AnyRoute,
  type ErrorComponentProps,
} from "@tanstack/react-router";
import { EmptyState } from "@pe/kit/lang/empty";
import { OutcomeLine } from "@pe/kit/lang/outcome";
import { Button } from "@pe/kit/lang/button";
import { routeTree } from "./routeTree.gen";
import { settingsRoute } from "./settings/route";
import { ductsRoute } from "./ducts/route";
import { ductLossRoute } from "./duct-loss/route";
import { grillesRoute } from "./grilles/route";
import { schedulesRoute } from "./schedules/route";
import { familiesRoute } from "./families/route";
import { familyRoute } from "./family/route";
import { roomsRoute } from "./rooms/route";
import { spaceRoute } from "./space/route";
import { takeoffsRoute } from "./takeoff/route";
import { podsRoute } from "./pods/route";
import { parameterLinksRoute } from "./parameter-links/route";
import { dataTablesRoute } from "./data-tables/route";
import { bindRoute } from "./pages-bind/route";
import { capturesRoute } from "./captures/route";
import { opsRoute } from "./ops/route";
import { openRoute } from "./open/route";
import { Route as rootRoute } from "./routes/__root";

// Use the unannotated root: the generated tree's file-only type map excludes code routes.
// `addChildren` mutates the root and returns it, so `routeTree.children` already holds the code
// routes once this module re-evaluates (SSR runner, HMR); re-adding by path keeps the tree idempotent.
const pathOf = (route: AnyRoute) => (route.options as { path?: string }).path;
const codeRoutes: AnyRoute[] = [
  settingsRoute,
  opsRoute,
  openRoute,
  ductLossRoute,
  grillesRoute,
  ductsRoute,
  schedulesRoute,
  familiesRoute,
  familyRoute,
  roomsRoute,
  spaceRoute,
  takeoffsRoute,
  podsRoute,
  parameterLinksRoute,
  dataTablesRoute,
  bindRoute,
  capturesRoute,
];
const codePaths = new Set(codeRoutes.map(pathOf));
const fileRoutes = (routeTree.children as unknown as AnyRoute[]).filter(
  (route) => !codePaths.has(pathOf(route)),
);
// The runtime value is an array (what addChildren stores); the type keeps the generated tree's map
// plus the code routes so `Register` stays fully typed for every useSearch/useRouterState consumer.
type FileChildren = {
  [K in keyof NonNullable<typeof routeTree.children>]: NonNullable<typeof routeTree.children>[K];
};
const appRouteTree = rootRoute.addChildren([
  ...fileRoutes,
  ...codeRoutes,
] as unknown as FileChildren & {
  settingsRoute: typeof settingsRoute;
  opsRoute: typeof opsRoute;
  openRoute: typeof openRoute;
  ductLossRoute: typeof ductLossRoute;
  grillesRoute: typeof grillesRoute;
  ductsRoute: typeof ductsRoute;
  schedulesRoute: typeof schedulesRoute;
  familiesRoute: typeof familiesRoute;
  familyRoute: typeof familyRoute;
  roomsRoute: typeof roomsRoute;
  spaceRoute: typeof spaceRoute;
  takeoffsRoute: typeof takeoffsRoute;
  podsRoute: typeof podsRoute;
  parameterLinksRoute: typeof parameterLinksRoute;
  dataTablesRoute: typeof dataTablesRoute;
  bindRoute: typeof bindRoute;
  capturesRoute: typeof capturesRoute;
});
function NotFound() {
  return (
    <main className="grid min-h-screen place-items-center">
      <Link to="/">
        <EmptyState story="scope" exit="return home">
          this route does not exist
        </EmptyState>
      </Link>
    </main>
  );
}

function RouteError({ error, reset }: ErrorComponentProps) {
  return (
    <main className="grid min-h-screen place-items-center">
      <div>
        <OutcomeLine kind="error" label="route failed" says={error.message} />
        <Button label="retry" kind="nav" direction="forward" onClick={reset}>
          retry
        </Button>
      </div>
    </main>
  );
}

export function getRouter() {
  const router = createTanStackRouter({
    routeTree: appRouteTree,
    scrollRestoration: true,
    defaultPreload: "intent",
    defaultPreloadStaleTime: 0,
    defaultNotFoundComponent: NotFound,
    defaultErrorComponent: RouteError,
  });

  return router;
}

declare module "@tanstack/react-router" {
  interface Register {
    router: ReturnType<typeof getRouter>;
  }
}
