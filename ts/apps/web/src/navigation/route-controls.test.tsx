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
import { route, paneLayout, scrollBody } from "@pe/web-kernel/route";
import { module as schedules } from "../schedules/route";
import { workFingerprintSchema } from "@pe/agent-contracts";

afterEach(cleanup);

test("two mounted typed routes publish only the addressed route's band", async () => {
  const modules = ["duct-systems", "fans"].map((key) =>
    route({
      key,
      name: key,
      needs: "browser",
      fields: {},
      directory: schedules.data.directory,
      panes: { main: { title: key, purpose: key, body: "scroll", draw: () => scrollBody(key) } },
      layout: paneLayout("main"),
    }),
  );
  const fingerprint = workFingerprintSchema.parse(`builtin-closure:${"0".repeat(64)}`);
  const root = createRootRoute({
    component: () => (
      <RouteControlsProvider>
        <BandOutlet />
        {modules.map((module) => (
          <TypedShell key={module.spec.key} module={module} fingerprint={fingerprint} />
        ))}
      </RouteControlsProvider>
    ),
  });
  const router = createRouter({
    routeTree: root,
    history: createMemoryHistory({ initialEntries: ["/duct-systems"] }),
  });
  await router.load();
  const view = render(<RouterProvider router={router} />);
  await waitFor(() =>
    expect(view.container.querySelectorAll('[data-slot="pane"]')).toHaveLength(2),
  );
  const bands = view.container.querySelectorAll('[data-slot="situation-band"]');
  expect(bands).toHaveLength(1);
  expect(bands[0]!.textContent).toContain("duct-systems");
  expect(view.container.querySelector('[data-slot="timeline-head"]')).toBeNull();
});

test("the shell attaches only its current owner's host across retained route switches", async () => {
  function Shell() {
    const path = useRouterState({ select: (state) => state.location.pathname });
    return (
      <RouteControlsProvider>
        <BandOutlet className="pe-appbar-situation" />
        {(["duct-systems", "fans"] as const).map((route) => (
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
      createRoute({ getParentRoute: () => root, path: "/duct-systems" }),
      createRoute({ getParentRoute: () => root, path: "/fans" }),
    ]),
    history: createMemoryHistory({ initialEntries: ["/duct-systems"] }),
  });
  await router.load();
  const view = render(<RouterProvider router={router} />);
  const outlet = view.container.querySelector(".pe-appbar-situation")!;
  expect(outlet.textContent).toBe("duct-systems controls");
  expect(view.container.querySelectorAll('[data-slot="situation-band"]')).toHaveLength(1);
  const firstHost = outlet.firstElementChild!;
  await act(async () => {
    await router.navigate({ to: "/$route", params: { route: "fans" } });
  });
  expect(outlet.childElementCount).toBe(1);
  expect(outlet.textContent).toBe("fans controls");
  expect(firstHost.isConnected).toBe(false);
  await act(async () => {
    await router.navigate({ to: "/$route", params: { route: "duct-systems" } });
  });
  expect(outlet.childElementCount).toBe(1);
  expect(outlet.firstElementChild).toBe(firstHost);
  expect(outlet.textContent).toBe("duct-systems controls");
});

// Row 11-pea-one-band: /pea needs the host and keeps no Work. Its band holds a host target, never a
// document, so it has no Work history and no recorded points: it draws no Timeline, not an empty one.
test("a host route with no Work draws one band and no Timeline", async () => {
  const pea = route({
    key: "chat",
    address: "/pea",
    name: "Pea",
    needs: "host",
    fields: {},
    directory: schedules.data.directory,
    panes: {
      main: {
        title: "Chat",
        purpose: "Read and compose",
        body: "scroll",
        draw: () => scrollBody("chat"),
      },
    },
    layout: paneLayout("main"),
  });
  const fingerprint = workFingerprintSchema.parse(`builtin-closure:${"0".repeat(64)}`);
  const root = createRootRoute({
    component: () => (
      <RouteControlsProvider>
        <BandOutlet />
        <TypedShell module={pea} fingerprint={fingerprint} />
      </RouteControlsProvider>
    ),
  });
  const router = createRouter({
    routeTree: root,
    history: createMemoryHistory({ initialEntries: ["/pea"] }),
  });
  await router.load();
  const view = render(<RouterProvider router={router} />);
  await waitFor(() =>
    expect(view.container.querySelectorAll('[data-slot="situation-band"]')).toHaveLength(1),
  );
  expect(view.container.querySelector('[data-slot="situation-band"]')!.textContent).toContain(
    "Pea",
  );
  expect(view.container.querySelector('[data-slot="timeline-head"]')).toBeNull();
  expect(view.container.textContent).not.toContain("No activity yet");
});
