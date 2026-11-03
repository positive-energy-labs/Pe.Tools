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
async function mounted(captures: unknown[] = [], sha = "abc") {
  const open = vi
    .spyOn(capturesAdapters.sources["captures.list"] as UseSource, "open")
    .mockImplementation((_, deliver) => {
      deliver({ kind: "complete", value: captures, revision: 1 });
    });
  const router = createRouter({
    routeTree: root.addChildren([capturesRoute]),
    history: createMemoryHistory({ initialEntries: [`/captures?sha=${sha}&open=${sha}`] }),
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

test("the admitted reading renders the retained capture and its restored detail", async () => {
  const { view } = await mounted(
    [
      {
        id: "taking",
        sha: "a".repeat(64),
        at: "2026-10-01T00:00:00Z",
        origin: "human",
        document: { title: "MEP" },
        view: { name: "Ground plan" },
        focus: null,
        registration: null,
        byteSize: 1,
        url: "/captures/abc.png",
      },
    ],
    "a".repeat(64),
  );
  expect(await view.findByText("Ground plan")).toBeTruthy();
  expect(await view.findByRole("link", { name: "open png" })).toBeTruthy();
});
