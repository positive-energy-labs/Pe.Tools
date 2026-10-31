// @vitest-environment jsdom
import { cleanup, render, waitFor, fireEvent } from "@testing-library/react";
import { createMemoryHistory, createRouter, RouterContextProvider } from "@tanstack/react-router";
import { afterEach, beforeEach, expect, test, vi } from "vite-plus/test";
import type { UseSource, ReadingContext, ReadingDelivery } from "#/shell/readings";
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

import { bindRoute, bindAdapters } from "./route";
import { pageBindRpc } from "../../../../packages/mcps/src/shared/rpc-client";
import { emptyThreadHead, type PageTargetReading } from "@pe/agent-contracts";
const target: PageTargetReading = {
  page: "tour",
  slot: "default",
  binding: { kind: "none" },
  resolution: { kind: "choose", reason: "ambiguous" },
  document: null,
  write: null,
};
async function mounted(url = "/bind?page=tour") {
  const read = vi.fn((ctx: ReadingContext, deliver: ReadingDelivery) => {
    deliver({
      kind: "complete",
      value: (ctx.page as { view: boolean }).view ? null : target,
      revision: 1,
    });
  });
  vi.spyOn(bindAdapters.sources["bind.target"] as UseSource, "open").mockImplementation(read);
  vi.spyOn(bindAdapters.sources["bind.threads"] as UseSource, "open").mockImplementation(
    (_, deliver) => {
      deliver({
        kind: "complete",
        value: [{ id: "t", title: "Duct study", head: emptyThreadHead }],
        revision: 1,
      });
    },
  );
  vi.spyOn(bindAdapters.sources["bind.inventory"] as UseSource, "open").mockImplementation(
    (_, deliver) => {
      deliver({ kind: "complete", value: { sessions: [] }, revision: 1 });
    },
  );
  const router = createRouter({
    routeTree: root.addChildren([bindRoute]),
    history: createMemoryHistory({ initialEntries: [url] }),
  });
  releases.push(router.history.subscribe(router.load));
  await router.load();
  const Component = bindRoute.options.component!;
  const view = render(
    <RouterContextProvider router={router}>
      <Component />
    </RouterContextProvider>,
  );
  return { view, router, read };
}
test("the picker binds through the human RPC verb and rereads the host resolution", async () => {
  const run = vi.spyOn(pageBindRpc, "run").mockResolvedValue(target);
  const { view, read } = await mounted();
  fireEvent.click(await view.findByText("Duct study"));
  await waitFor(() =>
    expect(run).toHaveBeenCalledWith(
      { slug: "tour", binding: { kind: "thread", thread: "t" } },
      expect.objectContaining({ target: { kind: "host" } }),
    ),
  );
  await view.findByText(/Bound\./);
  await waitFor(() => expect(read.mock.calls.length).toBeGreaterThan(1));
});
test("viewer preserves the Page query and fragment in its separate document", async () => {
  const run = vi.spyOn(pageBindRpc, "run");
  const { view, router } = await mounted(
    `/bind?${new URLSearchParams({ page: "tour", view: "true", query: "a=1&b=two words", fragment: "section-2" })}`,
  );
  const frame = await view.findByTitle("Page tour");
  expect(frame.getAttribute("src")).toBe("/pages/tour/?a=1&b=two+words#section-2");
  expect(router.state.location.search).toMatchObject({ page: "tour", view: true });
  expect(view.queryByTestId("pages-bind")).toBeNull();
  expect(run).not.toHaveBeenCalled();
});
