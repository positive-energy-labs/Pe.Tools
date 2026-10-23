// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import { afterEach, expect, test, vi } from "vite-plus/test";
import { routeAddress } from "@pe/agent-contracts";
import { useRoute } from "#/route";
import { LevelPlan } from "./level-plan";
import { manifest } from "./manifest";
import { mockModel } from "./proto/mock";
import { projectMockModel } from "./proto/project-model";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

test("takeoffs plane gestures replace the address, minimap moves push, and Back restores the pose", async () => {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      constructor(private read: ResizeObserverCallback) {}
      observe() {
        this.read(
          [{ contentRect: { width: 800, height: 400 } }] as ResizeObserverEntry[],
          this as unknown as ResizeObserver,
        );
      }
      disconnect() {}
    },
  );
  vi.stubGlobal(
    "EventSource",
    class {
      close() {}
      addEventListener() {}
      removeEventListener() {}
    },
  );
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
  const model = projectMockModel(mockModel());
  const level = model.lanes[0]!.label;
  const zones = model.zones.filter((zone) => zone.zone.lane.label === level);
  function Plan() {
    const handle = useRoute(manifest, { target: null, url: true });
    const [page, setPage] = handle.page;
    return (
      <LevelPlan
        viewport={page.viewport}
        onViewport={(viewport, how) =>
          setPage({ viewport }, { history: how === "move" ? "push" : "replace" })
        }
        zones={zones}
        shown={null}
        selectedKey={null}
        cursor={null}
        stateOf={() => "unreviewed"}
        onSelectZone={() => {}}
        onHover={() => {}}
        onCursor={() => {}}
      />
    );
  }
  const history = createMemoryHistory({ initialEntries: [`/takeoffs?level=${level}`] });
  const router = createRouter({ routeTree: createRootRoute({ component: Plan }), history });
  await router.load();
  const view = render(<RouterProvider router={router} />);
  const host = await waitFor(() => {
    const node = view.container.querySelector<HTMLElement>("[data-takeoff-plan]");
    expect(node).toBeTruthy();
    return node!;
  });
  const place = () => routeAddress("takeoffs").read(router.state.location.search).page;
  expect(place().viewport).toBeNull();
  fireEvent.wheel(host, { clientX: 200, clientY: 100, deltaY: -120 });
  await waitFor(() => expect(place().viewport).not.toBeNull());
  expect(history.length).toBe(1);
  const zoomed = place().viewport;
  fireEvent.click(view.getByRole("button", { name: "map" }));
  fireEvent.click(view.container.querySelector("canvas")!, { clientX: 210, clientY: 30 });
  await waitFor(() => expect(history.length).toBe(2));
  expect(place().viewport).not.toEqual(zoomed);
  act(() => history.back());
  await waitFor(() => expect(place().viewport).toEqual(zoomed));
});
