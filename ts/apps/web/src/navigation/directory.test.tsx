// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vite-plus/test";
import { Directory } from "./directory";

vi.mock("./state", () => ({
  useDestination: () => vi.fn(),
  useNavigation: () => ({
    snapshot: {
      observedAt: "2026-10-13T04:00:00Z",
      works: [
        {
          id: "saved-family",
          route: "family",
          label: "A saved Family Work",
          context: "Family.rfa",
          state: "saved",
          url: "/family?target=exact",
          reason: null,
          revision: 2,
        },
      ],
      threads: [],
      observations: [],
      truncated: false,
    },
    loading: false,
    error: null,
    refresh: vi.fn(),
  }),
}));
vi.mock("./route-controls", () => ({ PrimaryRouteControls: () => null }));
afterEach(cleanup);

test("A–Z removes task shelves and sorts all tools while their Works stay attached", () => {
  const view = render(<Directory />);
  expect(view.container.querySelectorAll("[data-navigation-group]").length).toBeGreaterThan(0);
  fireEvent.click(screen.getByRole("button", { name: "Sort by name" }));
  expect(view.container.querySelectorAll("[data-navigation-group]")).toHaveLength(0);
  const tools = screen
    .getAllByRole("button", { name: /^Open / })
    .map((button) => button.textContent);
  expect(tools.slice(0, 5)).toEqual([
    "Captures",
    "Data Tables",
    "Design System",
    "Doc Lab",
    "Duct Loss",
  ]);
  const family = screen.getByRole("button", { name: "Open Family" }).closest(".min-w-0.py-2")!;
  expect(family.textContent).toContain("A saved Family Work");
  expect(view.container.querySelector(".md\\:grid-cols-2")).toBeTruthy();
});
