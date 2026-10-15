// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vite-plus/test";
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from "@tanstack/react-router";
import { SurfaceHostProvider } from "./surface-host";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

test("the tray adapter keeps Pea local and hands router, ordinary-anchor and native navigation to Families off without replacing the tray", async () => {
  let message: ((event: { data: unknown }) => void) | undefined;
  const posted = vi.fn();
  vi.stubGlobal("matchMedia", () => ({
    matches: false,
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
  vi.stubGlobal("chrome", {
    webview: {
      postMessage: posted,
      addEventListener: (_event: string, listener: typeof message) => {
        message = listener;
      },
      removeEventListener: () => {},
    },
  });
  const root = createRootRoute({
    validateSearch: (search) => ({ shell: search.shell }),
    component: () => (
      <SurfaceHostProvider>
        <a href="/families?thread=chosen#parameter">Families link</a>
        <Outlet />
      </SurfaceHostProvider>
    ),
  });
  const routes = ["open", "pea", "machine", "families"].map((path) =>
    createRoute({ getParentRoute: () => root, path, component: () => <p>{path} body</p> }),
  );
  const router = createRouter({
    routeTree: root.addChildren(routes),
    history: createMemoryHistory({ initialEntries: ["/open?shell=tray"] }),
  });
  await router.load();
  render(<RouterProvider router={router} />);
  await screen.findByText("open body");
  await act(() => router.navigate({ to: "/pea", search: { shell: "tray" } }));
  await screen.findByText("pea body");
  const handed = () =>
    posted.mock.calls
      .map(([value]) => JSON.parse(value))
      .filter((value) => value.type === "open-window");
  expect(handed()).toHaveLength(0);
  fireEvent.click(screen.getByRole("link", { name: "Families link" }));
  await waitFor(() => expect(handed()).toHaveLength(1));
  expect(handed()[0].url).toBe(
    new URL("/families?thread=chosen#parameter", window.location.origin).href,
  );
  expect(router.state.location.pathname).toBe("/pea");
  act(() => {
    void router.navigate({ href: "/families?shell=tray" });
  });
  await waitFor(() => expect(handed()).toHaveLength(2));
  expect(router.state.location.pathname).toBe("/pea");
  act(() =>
    message?.({
      data: {
        type: "navigation-request",
        url: new URL("/families?shell=tray#native", window.location.origin).href,
      },
    }),
  );
  await waitFor(() => expect(handed()).toHaveLength(3));
  expect(handed()[2].url).toBe(new URL("/families#native", window.location.origin).href);
  expect(router.state.location.pathname).toBe("/pea");
});
