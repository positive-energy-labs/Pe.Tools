// @vitest-environment jsdom
import { Activity } from "react";
import { act, cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, expect, test } from "vite-plus/test";
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
  useRouterState,
} from "@tanstack/react-router";
import { RouteBand, BandOutlet, RouteControlsProvider } from "./route-controls";
import { TypedShell } from "../shell/typed-shell";
import { route, paneLayout, scrollBody } from "../route/defaults";
import { module as schedules } from "../schedules/route";
import { workFingerprintSchema } from "@pe/agent-contracts";

afterEach(cleanup);

test("two mounted typed routes publish only the addressed route's band", async () => {
  const modules = ["ducts", "fans"].map(key => route({ key, name: key, needs: "browser", fields: {},
    directory: schedules.data.directory, panes: { main: { title: key, purpose: key, body: "scroll", draw: () => scrollBody(key) } },
    layout: paneLayout("main") }));
  const fingerprint = workFingerprintSchema.parse(`builtin-closure:${"0".repeat(64)}`);
  const root = createRootRoute({ component: () => <RouteControlsProvider><BandOutlet />
    {modules.map(module => <TypedShell key={module.spec.key} module={module} fingerprint={fingerprint} />)}
  </RouteControlsProvider> });
  const router = createRouter({ routeTree: root, history: createMemoryHistory({ initialEntries: ["/ducts"] }) });
  await router.load();
  const view = render(<RouterProvider router={router} />);
  await waitFor(() => expect(view.container.querySelectorAll('[data-slot="pane"]')).toHaveLength(2));
  const bands = view.container.querySelectorAll('[data-slot="situation-band"]');
  expect(bands).toHaveLength(1);
  expect(bands[0]!.textContent).toContain("ducts");
  expect(view.container.querySelector('[data-slot="timeline-head"]')).toBeNull();
});

test("the shell attaches only its current owner's host across retained route switches", async () => {
  function Shell() {
    const path = useRouterState({ select: (state) => state.location.pathname });
    return (
      <RouteControlsProvider>
        <BandOutlet className="pe-appbar-situation" />
        {(["ducts", "fans"] as const).map((route) => (
          <Activity key={route} mode={path === `/${route}` ? "visible" : "hidden"}>
            <RouteBand route={route}>
              <span data-slot="situation-band">{route} controls</span>
            </RouteBand>
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
  expect(view.container.querySelectorAll('[data-slot="situation-band"]')).toHaveLength(1);
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
