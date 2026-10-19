// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vite-plus/test";
import {
  createRootRoute,
  createRoute,
  createRouter,
  createMemoryHistory,
  Outlet,
  RouterProvider,
  stripSearchParams,
} from "@tanstack/react-router";
import { Directory } from "./directory";
import { directorySearch, DIRECTORY_DEFAULTS } from "./directory-search";
import { SettingsProvider, SettingsProjection } from "#/settings/options";

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
vi.mock("./route-controls", () => ({
  PrimaryRouteControls: () => null,
  useIsPrimaryRoute: () => true,
}));
afterEach(cleanup);

async function directoryFixture(initial = "/", quick = false) {
  const history = createMemoryHistory({ initialEntries: [initial] });
  const root = createRootRoute({
    validateSearch: (search: Record<string, unknown>) => search,
    component: () => (
      <SettingsProvider>
        <Outlet />
        {quick && <SettingsProjection quick subject="index" />}
      </SettingsProvider>
    ),
  });
  const index = createRoute({
    getParentRoute: () => root,
    path: "/",
    validateSearch: directorySearch,
    search: { middlewares: [stripSearchParams({ ...DIRECTORY_DEFAULTS })] },
    component: Directory,
  });
  const router = createRouter({ routeTree: root.addChildren([index]), history });
  const view = render(<RouterProvider router={router} />);
  await screen.findByRole("textbox", { name: "Search tools and tasks" });
  return { ...view, router, history };
}

test("A–Z removes task shelves and sorts all tools while their Works stay attached", async () => {
  const view = await directoryFixture();
  expect(view.container.querySelectorAll("[data-navigation-group]").length).toBeGreaterThan(0);
  fireEvent.click(screen.getByRole("button", { name: "Sort by name" }));
  await waitFor(() =>
    expect(view.container.querySelectorAll("[data-navigation-group]")).toHaveLength(0),
  );
  expect(view.history.location.search).toBe("?sort=name");
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

test("directory and Settings controls share URL state, history restores it, and reset retains sort", async () => {
  const view = await directoryFixture(
    "/?query=family&exposure=Main&sort=name&thread=kept&shell=tray&owner=external",
    true,
  );
  expect(
    screen.getByRole("textbox", { name: "Search tools and tasks" }).getAttribute("value"),
  ).toBe("family");
  expect(
    screen.getByRole("button", { name: "Show Main exposure" }).getAttribute("aria-pressed"),
  ).toBe("true");
  const settingsExposure = within(screen.getByRole("group", { name: "Show tools" }));
  fireEvent.click(settingsExposure.getByRole("button", { name: "Preview" }));
  await waitFor(() =>
    expect(new URLSearchParams(view.history.location.search).get("exposure")).toBe("Preview"),
  );
  expect(
    screen.getByRole("button", { name: "Show Preview exposure" }).getAttribute("aria-pressed"),
  ).toBe("true");
  await act(async () => {
    view.history.back();
  });
  await waitFor(() =>
    expect(
      screen.getByRole("button", { name: "Show Main exposure" }).getAttribute("aria-pressed"),
    ).toBe("true"),
  );
  await act(async () => {
    view.history.forward();
  });
  await waitFor(() =>
    expect(
      settingsExposure.getByRole("button", { name: "Preview" }).getAttribute("aria-pressed"),
    ).toBe("true"),
  );
  fireEvent.change(screen.getByRole("textbox", { name: "Search tools and tasks" }), {
    target: { value: "no-tool-matches-this" },
  });
  await screen.findByRole("button", { name: "Clear directory filters" });
  fireEvent.click(screen.getByRole("button", { name: "Clear directory filters" }));
  await waitFor(() =>
    expect(new URLSearchParams(view.history.location.search).has("query")).toBe(false),
  );
  const search = new URLSearchParams(view.history.location.search);
  expect(search.has("exposure")).toBe(false);
  expect(search.get("sort")).toBe("name");
  expect(search.get("thread")).toBe("kept");
  expect(search.get("shell")).toBe("tray");
  expect(search.get("owner")).toBe("external");
  expect(view.container.querySelectorAll("[data-navigation-group]")).toHaveLength(0);
});

test("directory search validates owned filters without interpreting unrelated fields", () => {
  expect(
    directorySearch({ query: 7, exposure: "unknown", sort: "unknown", owner: "retained" }),
  ).toEqual({ ...DIRECTORY_DEFAULTS, owner: "retained" });
});
