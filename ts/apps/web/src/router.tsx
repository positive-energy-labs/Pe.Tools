import {
  createRouter as createTanStackRouter,
  Link,
  type ErrorComponentProps,
} from "@tanstack/react-router";
import { EmptyState } from "@pe/kit/lang/empty";
import { OutcomeLine } from "@pe/kit/lang/outcome";
import { Button } from "@pe/kit/lang/button";
import { routeTree } from "./routeTree.gen";

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
    routeTree,
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
