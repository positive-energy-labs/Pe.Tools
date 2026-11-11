// @vitest-environment jsdom
import { Activity } from "react";
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, expect, test } from "vite-plus/test";
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
  useRouterState,
} from "@tanstack/react-router";
import { PrimaryRouteControls, RouteControlsOutlet, RouteControlsProvider } from "./route-controls";

afterEach(cleanup);

test("the shell attaches only its current owner's host across retained route switches", async () => {
  function Shell() {
    const path = useRouterState({ select: (state) => state.location.pathname });
    return (
      <RouteControlsProvider>
        <RouteControlsOutlet slot="situation" as="div" className="pe-appbar-situation" />
        {(["ducts", "fans"] as const).map((route) => (
          <Activity key={route} mode={path === `/${route}` ? "visible" : "hidden"}>
            <PrimaryRouteControls route={route} slot="situation">
              <span>{route} controls</span>
            </PrimaryRouteControls>
          </Activity>
        ))}
      </RouteControlsProvider>
    );
  }
  const root = createRootRoute({ component: Shell });
  const router = createRouter({
    routeTree: root.addChildren([
      createRoute({ getParentRoute: () => root, path: "/ducts" }),
      createRoute({ getParentRoute: () => root, path: "/fans" }),
    ]),
    history: createMemoryHistory({ initialEntries: ["/ducts"] }),
  });
  await router.load();
  const view = render(<RouterProvider router={router} />);
  const outlet = view.container.querySelector(".pe-appbar-situation")!;
  expect(outlet.textContent).toBe("ducts controls");
  const firstHost = outlet.firstElementChild!;
  await act(async () => {
    await router.navigate({ to: "/$route", params: { route: "fans" } });
  });
  expect(outlet.childElementCount).toBe(1);
  expect(outlet.textContent).toBe("fans controls");
  expect(firstHost.isConnected).toBe(false);
  await act(async () => {
    await router.navigate({ to: "/$route", params: { route: "ducts" } });
  });
  expect(outlet.childElementCount).toBe(1);
  expect(outlet.firstElementChild).toBe(firstHost);
  expect(outlet.textContent).toBe("ducts controls");
});
