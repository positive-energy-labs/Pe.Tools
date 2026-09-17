// @vitest-environment jsdom
/**
 * `/families?demo=plan` must mount without React's "Maximum update depth exceeded": the demo lane
 * seeds Work and Readings once, so nothing in the store may re-derive a fresh identity per render.
 */
import { afterEach, beforeEach, expect, test, vi } from "vite-plus/test";
import { cleanup, render, screen } from "@testing-library/react";
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";

vi.mock("#/host/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("#/host/client")>();
  return {
    ...actual,
    callHostRpc: (key: string) => Promise.reject(new Error(`no host in test: ${key}`)),
    callHostDynamic: () => Promise.reject(new Error("no host in test")),
  };
});

import { FamiliesRouteContent } from "#/routes/families";

class DeadSource {
  close() {}
  addEventListener() {}
  removeEventListener() {}
}
(globalThis as { EventSource?: unknown }).EventSource = DeadSource;

let errors: string[] = [];
beforeEach(() => {
  errors = [];
  window.history.replaceState({}, "", "/families?demo=plan");
  vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
    errors.push(args.map(String).join(" "));
  });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

test("the families demo lane mounts without an update-depth loop", async () => {
  const router = createRouter({
    routeTree: createRootRoute({ component: () => <FamiliesRouteContent /> }),
    history: createMemoryHistory({ initialEntries: ["/families?demo=plan"] }),
  });
  await router.load();
  const { container } = render(<RouterProvider router={router} />);
  expect(await screen.findByRole("heading", { name: "Families" })).toBeTruthy();
  expect(await screen.findByText("families in scope")).toBeTruthy();
  expect(container.querySelectorAll("[data-slot='pane-header']")).toHaveLength(0);
  await new Promise((resolve) => setTimeout(resolve, 200));
  const depth = errors.filter((line) => /Maximum update depth/.test(line));
  expect(depth, depth.join("\n")).toEqual([]);
});
