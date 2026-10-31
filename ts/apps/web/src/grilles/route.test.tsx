// @vitest-environment jsdom
import { cleanup, fireEvent, render, waitFor, within } from "@testing-library/react";
import { createMemoryHistory, createRouter, RouterContextProvider } from "@tanstack/react-router";
import { afterEach, beforeEach, expect, test, vi } from "vite-plus/test";
import { readTeaching } from "@pe/kit/lang/teach";
import { Route as root } from "../routes/__root";
import { grillesGraph } from "./graph";
import { grillesAdapters, grillesRoute } from "./route";
import { seedRows } from "./sheet";
import { enumerate, ribToFill, solve } from "./math";
import { solvePage } from "./sources";

// Only the app chrome's parent route is a fixture. The graph, route component, sources,
// kernel owner and panes are production code, independent of concurrent route ports.
vi.mock("../routes/__root", async () => ({
  Route: (await import("@tanstack/react-router")).createRootRoute(),
}));

const releases: (() => void)[] = [];
beforeEach(() => {
  grillesAdapters.wrap = (_owner, children) => children;
  vi.stubGlobal(
    "fetch",
    vi.fn(() => Promise.reject(new Error("Grilles must not call a host"))),
  );
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(600);
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(1200);
});
afterEach(async () => {
  cleanup();
  for (const release of releases.splice(0)) release();
  await new Promise((resolve) => setTimeout(resolve, 5));
  expect(fetch).not.toHaveBeenCalled();
  vi.restoreAllMocks();
  delete grillesAdapters.wrap;
  vi.unstubAllGlobals();
});

async function mounted(url = "/grilles") {
  const wrap = vi.spyOn(grillesAdapters, "wrap").mockImplementation((_owner, children) => children);
  const router = createRouter({
    routeTree: root.addChildren([grillesRoute]),
    history: createMemoryHistory({ initialEntries: [url] }),
  });
  releases.push(router.history.subscribe(router.load));
  await router.load();
  const Component = grillesRoute.options.component!;
  const view = render(
    <RouterContextProvider router={router}>
      <Component />
    </RouterContextProvider>,
  );
  await view.findByLabelText("profile count");
  const owner = () => wrap.mock.calls.at(-1)![0];
  const page = () => owner().view.read().page;
  const reading = () => owner().readings.get("result").value as ReturnType<typeof solvePage>;
  return { view, router, page, reading };
}

test("the real graph mounts workbook profiles, restores address and supplies pane scopes", async () => {
  const { view, page, reading, router } = await mounted("/grilles?row=row9&sheet=true");
  expect(router.routesByPath["/grilles"]).toBe(grillesRoute);
  expect(page().rows).toEqual(seedRows());
  expect(reading().active).toEqual(seedRows()[2]);
  expect(reading().field).toEqual(enumerate(seedRows()[2]!));
  expect(view.getByText("export sheet")).toBeTruthy();
  expect(view.container.querySelectorAll("#grille-export-sheet figure")).toHaveLength(1);
  const scopes = readTeaching().flatMap((entry) => (entry.kind === "keys" ? [entry.scope] : []));
  for (const id of Object.keys(grillesGraph.panes)) {
    expect(view.container.querySelector(`[data-pane-id='${id}']`)).toBeTruthy();
    expect(scopes).toContain(id);
  }
  expect(grillesGraph.verbs).toEqual({});
});

test("drawing edits solve every row, field picks edit only the active profile, reset restores the fixture", async () => {
  const { view, page, reading } = await mounted();
  const drawing = view.container.querySelector("[data-pane-id='drawing']")!;
  const length = drawing.querySelector("input")!;
  expect(length.value).toBe("18");
  fireEvent.change(length, { target: { value: "24" } });
  fireEvent.blur(length);
  await waitFor(() => expect(reading().rows.every((row) => row.boardLength === 24)).toBe(true));
  for (const row of reading().rows) {
    expect(row.rib).toBeCloseTo(Math.max(0, ribToFill(row)));
    expect(row.actualFreeArea).toBe(solve(row).actualFreeArea);
  }
  const before = page().rows;
  const point = view.container.querySelector("[data-pane-id='field'] circle")!;
  fireEvent.click(point);
  await waitFor(() => expect(page().rows[0]).not.toEqual(before[0]));
  expect(page().rows.slice(1)).toEqual(before.slice(1));
  fireEvent.keyDown(view.getByLabelText("Buildable field"), { key: "ArrowRight" });
  await waitFor(() => expect(reading().active?.openings).toBeGreaterThan(1));
  fireEvent.click(view.getByRole("button", { name: "reset" }));
  await waitFor(() => expect(page().rows).toEqual(seedRows()));
});

test("adding a profile and opening and closing export use kernel Page and URL history", async () => {
  const { view, router, page } = await mounted();
  fireEvent.click(view.getByRole("button", { name: "+ profile" }));
  await waitFor(() => expect(page().rows).toHaveLength(7));
  expect(page().row).toBe("new7");
  await waitFor(() => expect(router.state.location.search.row).toBe("new7"));
  fireEvent.click(view.getByRole("button", { name: "export 1 drawing" }));
  await waitFor(() => expect(router.state.location.search.sheet).toBeDefined());
  expect(view.container.querySelectorAll("#grille-export-sheet figure")).toHaveLength(1);
  fireEvent.change(view.getByPlaceholderText("project / location"), {
    target: { value: "Fixture project" },
  });
  expect(page().project).toBe("Fixture project");
  expect(router.state.location.search).not.toHaveProperty("project");
  expect(router.state.location.search).not.toHaveProperty("rows");
  fireEvent.click(
    within(view.container.querySelector("[data-pane-id='profiles']")!).getByRole("button", {
      name: "close",
    }),
  );
  await waitFor(() => expect(view.queryByText("export sheet")).toBeNull());
  await waitFor(() => expect(page().sheet).toBe(false));
  router.history.back();
  await waitFor(() => expect(view.getByText("export sheet")).toBeTruthy());
});
