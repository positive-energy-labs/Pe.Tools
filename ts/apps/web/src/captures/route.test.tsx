// @vitest-environment jsdom
import { cleanup, render, waitFor, fireEvent } from "@testing-library/react";
import { createMemoryHistory, createRouter, RouterContextProvider } from "@tanstack/react-router";
import { afterEach, beforeEach, expect, test, vi } from "vite-plus/test";
import type { UseSource } from "#/shell/readings";
import { Route as root } from "../routes/__root";
vi.mock("../routes/__root", async () => ({
  Route: (await import("@tanstack/react-router")).createRootRoute(),
}));
const releases: (() => void)[] = [];
beforeEach(() => {
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
afterEach(() => {
  cleanup();
  releases.splice(0).forEach((release) => release());
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

import { capturesRoute, capturesAdapters } from "./route";
import { captureQueries } from "./host";
async function mounted() {
  const open = vi
    .spyOn(capturesAdapters.sources["captures.list"] as UseSource, "open")
    .mockImplementation((_, deliver) => {
      deliver({ kind: "complete", value: [], revision: 1 });
    });
  const router = createRouter({
    routeTree: root.addChildren([capturesRoute]),
    history: createMemoryHistory({ initialEntries: ["/captures?sha=abc&open=abc"] }),
  });
  releases.push(router.history.subscribe(router.load));
  await router.load();
  const Component = capturesRoute.options.component!;
  const view = render(
    <RouterContextProvider router={router}>
      <Component />
    </RouterContextProvider>,
  );
  return { view, router, open };
}
test("host-scoped refresh publishes its query without reacquiring the retained list", async () => {
  const run = vi.spyOn(captureQueries["captures.list"], "run").mockResolvedValue([]);
  const { view, router, open } = await mounted();
  await waitFor(() => expect(open).toHaveBeenCalled());
  const before = open.mock.calls.length;
  fireEvent.click(await view.findByRole("button", { name: /^refresh$/ }));
  await waitFor(() =>
    expect(run).toHaveBeenCalledWith({}, { target: { kind: "host" }, work: null }),
  );
  expect(run).toHaveBeenCalledTimes(1);
  expect(open.mock.calls.length).toBe(before);
  expect(router.state.location.search.sha).toBe("abc");
  expect(view.queryByLabelText("Document")).toBeNull();
});
