// @vitest-environment jsdom
/** The chrome Settings popover carries the active route's own section through the `settings` slot. */
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vite-plus/test";
import { ChromeSettings } from "./chrome-settings";
import { PrimaryRouteControls, RouteControlsProvider } from "./route-controls";
import { SurfaceHostProvider } from "./surface-host";

afterEach(cleanup);

test("a primary route's settings section appears inside the Settings popover, and only there", async () => {
  vi.stubGlobal("matchMedia", () => ({
    matches: false,
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
  const root = createRootRoute({
    component: () => (
      <SurfaceHostProvider>
        <RouteControlsProvider>
          <ChromeSettings />
          <PrimaryRouteControls route="ducts" slot="settings">
            <p>ducts own section</p>
          </PrimaryRouteControls>
        </RouteControlsProvider>
      </SurfaceHostProvider>
    ),
  });
  const ducts = createRoute({ getParentRoute: () => root, path: "ducts" });
  const router = createRouter({
    routeTree: root.addChildren([ducts]),
    history: createMemoryHistory({ initialEntries: ["/ducts"] }),
  });
  await router.load();
  render(<RouterProvider router={router} />);
  fireEvent.click(await screen.findByRole("button", { name: "Settings" }));
  const section = await screen.findByText("ducts own section");
  expect(section.closest('[aria-label="Settings menu"]')).not.toBeNull();
});
