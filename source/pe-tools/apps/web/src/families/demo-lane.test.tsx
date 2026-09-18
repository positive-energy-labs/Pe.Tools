// @vitest-environment jsdom
/**
 * `/families?demo=apply` must mount without React's "Maximum update depth exceeded": the demo lane
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
  window.history.replaceState({}, "", "/families?demo=apply");
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
    history: createMemoryHistory({ initialEntries: ["/families?demo=apply"] }),
  });
  await router.load();
  const { container } = render(<RouterProvider router={router} />);
  expect(await screen.findByRole("heading", { name: "Families" })).toBeTruthy();
  expect(await screen.findByText("families in scope")).toBeTruthy();
  // The apply seed opens the confirmation sheet on the demo plan: one held back, one refused.
  const sheet = await screen.findByRole("region", { name: "Confirmation sheet" });
  expect(sheet.textContent).toContain("1 / 3 included");
  expect(sheet.textContent).toContain("no mapping source");
  expect(container.querySelector("[data-slot='pane-header']")).toBeTruthy();
  await new Promise((resolve) => setTimeout(resolve, 200));
  const depth = errors.filter((line) => /Maximum update depth/.test(line));
  expect(depth, depth.join("\n")).toEqual([]);
});

test("with the plan sheet open, the sheet's apply is the one apply button (w8-revit trip 5)", async () => {
  const router = createRouter({
    routeTree: createRootRoute({ component: () => <FamiliesRouteContent /> }),
    history: createMemoryHistory({ initialEntries: ["/families?demo=apply"] }),
  });
  await router.load();
  render(<RouterProvider router={router} />);
  const sheet = await screen.findByRole("region", { name: "Confirmation sheet" });
  // Every button that would start `families.apply`: the verb row's `apply families`, the staged
  // band's commit, and the sheet's `apply N rows`. Only the sheet's may exist.
  const applies = screen
    .getAllByRole("button")
    .filter((button) => /^apply (families|\d+ rows?)/.test(button.textContent?.trim() ?? ""));
  expect(applies.map((button) => button.textContent?.trim())).toHaveLength(1);
  expect(sheet.contains(applies[0]!)).toBe(true);
});
