// @vitest-environment jsdom
import { cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, expect, test } from "vite-plus/test";
import { createMemoryHistory, createRootRoute, createRoute, createRouter,
  RouterProvider, RouterContextProvider, useRouterState } from "@tanstack/react-router";
import { useRouteActivity, type RouteActivityScope } from "#/route/activity";
import { RouteRetention } from "./route-retention";
afterEach(cleanup);

test("retaining the tools index selects its leaf rather than the root with the same full path", async () => {
  const root = createRootRoute({ component: () => <output>root shell</output> });
  const index = createRoute({
    getParentRoute: () => root,
    path: "/",
    component: () => <output>tools index</output>,
  });
  const router = createRouter({
    routeTree: root.addChildren([index]),
    history: createMemoryHistory({ initialEntries: ["/"] }),
  });
  await router.load();
  const view = render(
    <RouterContextProvider router={router}>
      <RouteRetention
        route="home"
        active={null}
        tabs={[]}
        ready={false}
        renderRoute={(body) => body}
      />
    </RouterContextProvider>,
  );
  expect(view.getByText("tools index")).toBeTruthy();
  expect(view.queryByText("root shell")).toBeNull();
});
test("an untabbed route keeps custody across its own history push, before the bank re-renders", async () => {
  let scope: RouteActivityScope | null = null;
  function Capture() {
    scope = useRouteActivity();
    return null;
  }
  function Root() {
    const location = useRouterState({ select: (state) => state.location });
    return (
      <RouteRetention
        route={location.pathname === "/ducts" ? "ducts" : null}
        active={null}
        tabs={[]}
        ready
        renderRoute={(body) => body}
      />
    );
  }
  const root = createRootRoute({ component: Root });
  const ducts = createRoute({ getParentRoute: () => root, path: "/ducts", component: Capture });
  const router = createRouter({
    routeTree: root.addChildren([ducts]),
    history: createMemoryHistory({ initialEntries: ["/ducts?selected=1"] }),
  });
  await router.load();
  render(<RouterProvider router={router} />);
  await waitFor(() => expect(scope?.current()).toBe(true));
  // The route's address port pushes; history updates synchronously, the bank re-renders later.
  router.history.push("/ducts?selected=2");
  expect(scope!.current()).toBe(true);
});
