// @vitest-environment jsdom
/**
 * `/families?target=<JSON open-ref>` must settle: the exact-target grammar is a JSON string in the
 * search, and the route must neither rewrite it forever nor hang the render.
 */
import { afterEach, beforeEach, expect, test, vi } from "vite-plus/test";
import { cleanup, render, screen } from "@testing-library/react";
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";

import { FamiliesRouteContent, familiesSearch } from "#/routes/families";

class DeadSource {
  close() {}
  addEventListener() {}
  removeEventListener() {}
}
(globalThis as { EventSource?: unknown }).EventSource = DeadSource;

const TARGET = JSON.stringify({
  kind: "open",
  ref: { session: "session-553a4c85413fe3ae", openId: "b5ee1195dc64417d9a106c4d37160963" },
});

let errors: string[] = [];
beforeEach(() => {
  errors = [];
  vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
    errors.push(args.map(String).join(" "));
  });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

test("an exact JSON target settles instead of hanging", async () => {
  const root = createRootRoute();
  const seen: unknown[] = [];
  const families = createRoute({
    getParentRoute: () => root,
    path: "/families",
    validateSearch: (search: Record<string, unknown>) => {
      const parsed = familiesSearch(search);
      seen.push(search.target);
      return parsed;
    },
    component: function FamiliesRoute() {
      const { target } = families.useSearch();
      return <FamiliesRouteContent target={target} />;
    },
  });
  const router = createRouter({
    routeTree: root.addChildren([families]),
    history: createMemoryHistory({
      initialEntries: [`/families?target=${encodeURIComponent(TARGET)}`],
    }),
  });
  await Promise.race([
    router.load(),
    new Promise((_, reject) => setTimeout(() => reject(new Error("router.load hung")), 3000)),
  ]);
  render(<RouterProvider router={router} />);
  expect(await screen.findByRole("heading", { name: "Families" })).toBeTruthy();
  await new Promise((resolve) => setTimeout(resolve, 300));
  expect(
    seen.length,
    `validateSearch ran ${seen.length}x; first: ${JSON.stringify(seen[0])}`,
  ).toBeLessThan(10);
  expect(router.state.location.search.target).toBe(TARGET);
  expect(errors.filter((line) => /Maximum update depth/.test(line))).toEqual([]);
});
