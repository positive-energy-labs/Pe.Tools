// @vitest-environment jsdom
import { act, cleanup, render, waitFor } from "@testing-library/react";
import { createMemoryHistory, createRouter, RouterContextProvider } from "@tanstack/react-router";
import { afterEach, beforeEach, expect, test, vi } from "vite-plus/test";
import { Route as root } from "../routes/__root";
import { takeoffAdapters, takeoffsRoute } from "./graph-route";
import { TakeoffsPane } from "./pane";
import { LiveTakeoffsRoute } from "./route";
import { TakeoffHostFixture } from "./host.fixture";
vi.mock("../routes/__root", async () => {
  const { createRootRoute } = await import("@tanstack/react-router");
  return { Route: createRootRoute() };
});
let host: TakeoffHostFixture;
beforeEach(() => {
  host = new TakeoffHostFixture();
  vi.stubGlobal("fetch", host.fetch);
  vi.stubGlobal("EventSource", host.source());
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
  vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(1600);
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(1600);
  const saved = new Map([
    ["pe.takeoffs.plan-height", "501"],
    ["pe.takeoffs.room-panel-width", "410"],
  ]);
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => saved.get(key) ?? null,
    setItem: (key: string, value: string) => saved.set(key, value),
  });
});
afterEach(async () => {
  cleanup();
  await new Promise((resolve) => setTimeout(resolve, 450));
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

test.each([TakeoffsPane, LiveTakeoffsRoute])(
  "takeoff hosted entry binds its target with URL off and restores existing pane sizes",
  async (Hosted) => {
    const wrap = vi.spyOn(takeoffAdapters, "wrap");
    const router = createRouter({
      routeTree: root.addChildren([takeoffsRoute]),
      history: createMemoryHistory({
        initialEntries: ["/takeoffs?work=foreign-capture&thread=outside"],
      }),
    });
    await router.load();
    const view = render(
      <RouterContextProvider router={router}>
        <Hosted url={false} target={host.target.session} thread="chat-thread" />
      </RouterContextProvider>,
    );
    await waitFor(() => expect(wrap.mock.calls.at(-1)?.[0].snapshot().work).toBeTruthy());
    const owner = wrap.mock.calls.at(-1)![0];
    expect(owner.view.read().page.work).toBe("");
    expect(owner.snapshot().target).toMatchObject({ kind: "document", ref: host.target });
    const seams = Array.from(view.container.querySelectorAll('[role="separator"]'));
    expect(seams.some((seam) => seam.getAttribute("aria-valuenow") === "501")).toBe(true);
    expect(seams.some((seam) => seam.getAttribute("aria-valuenow") === "410")).toBe(true);
    const href = router.history.location.href;
    act(() => owner.view.setPage({ stage: "sync" }));
    expect(router.history.location.href).toBe(href);
    view.rerender(
      <RouterContextProvider router={router}>
        <Hosted
          url={false}
          target={host.target.session}
          thread="chat-thread"
          work="selected-capture"
        />
      </RouterContextProvider>,
    );
    await waitFor(() => expect(owner.view.read().page.work).toBe("selected-capture"));
    expect(router.history.location.href).toBe(href);
  },
);
