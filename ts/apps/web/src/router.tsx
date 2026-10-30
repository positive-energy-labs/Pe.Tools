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
import { ductsRoute } from "./ducts/route";
import { ductLossRoute } from "./duct-loss/route";
import { schedulesRoute } from "./schedules/route";
import { familiesRoute } from "./families/route";
import { Route as rootRoute } from "./routes/__root";
import { publicRoutes } from "./route/builtin-routes";
import { ShellProbe, ShellProbeRoute, shellProbe } from "./route/shell-probe";

// Use the unannotated root: the generated tree's file-only type map excludes code routes.
// `addChildren` mutates the root and returns it, so `routeTree.children` already holds the code
// routes once this module re-evaluates (SSR runner, HMR); re-adding by path keeps the tree idempotent.
const pathOf = (route: AnyRoute) => (route.options as { path?: string }).path;
const codeRoutes: AnyRoute[] = [
  ShellProbeRoute,
  ductLossRoute,
  ductsRoute,
  schedulesRoute,
  familiesRoute,
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
  ShellProbeRoute: typeof ShellProbeRoute;
  ductLossRoute: typeof ductLossRoute;
  ductsRoute: typeof ductsRoute;
  schedulesRoute: typeof schedulesRoute;
  familiesRoute: typeof familiesRoute;
});
const unregisterProbe = publicRoutes.register({
  manifest: shellProbe.manifest,
  hosted: () => <ShellProbe />,
});
if (import.meta.hot) import.meta.hot.dispose(unregisterProbe);

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
