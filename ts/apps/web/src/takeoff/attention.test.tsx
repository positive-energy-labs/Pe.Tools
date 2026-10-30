// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import { afterEach, expect, test, vi } from "vite-plus/test";
import { Row } from "@pe/kit/lang/row";
import { attention, elementKey, setHovered, useMention } from "@pe/kit/lang/attention";
import { useEffect, useSyncExternalStore } from "react";
import { createGraphMount } from "#/shell/mount";
import { takeoffGraph } from "./graph";
import { takeoffAdapters } from "./graph-route";
import { useTakeoffStore } from "./store";
import type { TakeoffStore } from "./store";
import { LevelPlan } from "./level-plan";
import { regionKey, TakeoffAttention } from "./attention";
import { mockModel } from "./proto/mock";
import { projectMockModel } from "./proto/project-model";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

test("zone and room rows share hover with the plan, while selection follows Page", async () => {
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
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
  const world = projectMockModel(mockModel());
  const zone = world.zones[0]!;
  const room = zone.rooms[0]!;
  zone.zone.elementId = 101;
  room.elementId = 102;
  const owner = createGraphMount(takeoffGraph, {
    ...takeoffAdapters,
    getSnapshot: () => ({ target: { kind: "host" }, work: null }),
    subscribe: () => () => {},
    write: async () => {
      throw Error("attention must not write Work");
    },
    subscribeAcceptedDeltas: () => () => {},
  });
  let handle!: TakeoffStore["handle"];
  function Rows() {
    const mention = useMention();
    return (
      <>
        <div data-testid="zone-row" {...mention(regionKey(zone.zone.guid))}>
          <Row label="zone row" />
        </div>
        <div data-testid="room-row" {...mention(regionKey(room.guid))}>
          <Row label="room row" />
        </div>
      </>
    );
  }
  function Plan() {
    useEffect(() => owner.connect(), []);
    useSyncExternalStore(owner.subscribe, owner.version, owner.version);
    handle = useTakeoffStore(owner).handle;
    const [page, setPage] = handle.page;
    return (
      <TakeoffAttention store={{ handle, world, savedCapture: undefined }}>
        <Rows />
        <LevelPlan
          readout={null}
          rows={[]}
          viewport={page.viewport}
          onViewport={(viewport) => setPage({ viewport })}
          zones={[zone]}
          shown={null}
          stateOf={() => "unreviewed"}
          onSelectZone={(picked) => setPage({ zone: picked?.zone.guid ?? "" })}
          onCursor={(_, guid) => setPage({ room: guid })}
        />
      </TakeoffAttention>
    );
  }
  const router = createRouter({
    routeTree: createRootRoute({ component: Plan }),
    history: createMemoryHistory(),
  });
  await router.load();
  const view = render(<RouterProvider router={router} />);
  const zoneRow = await view.findByTestId("zone-row");
  const roomRow = view.getByTestId("room-row");
  const picture = view.container.querySelector("[data-takeoff-plan]")!;
  const zoneShape = picture.querySelector(`[data-subject="${regionKey(zone.zone.guid)}"]`)!;
  const roomShape = picture.querySelector(`[data-subject="${regionKey(room.guid)}"]`)!;
  const zonePath = zoneShape.querySelector("path")!;
  const roomPath = roomShape.matches("circle") ? roomShape : roomShape.querySelector("path")!;
  fireEvent.pointerOver(zoneRow);
  await waitFor(() => expect(zonePath.getAttribute("stroke-width")).toBe("2"));
  expect(handle.registry.get(attention("fixture:takeoffs:plan")).hovered).toEqual(
    new Set([elementKey(101)]),
  );
  fireEvent.pointerOver(roomShape);
  await waitFor(() => expect(roomRow.getAttribute("data-reach")).toBe("hover"));
  expect(zoneRow.getAttribute("data-reach")).toBe("rest");
  expect(roomPath.getAttribute("stroke-width")).toBe("2");
  fireEvent.pointerOver(roomRow);
  expect(roomShape.getAttribute("data-reach")).toBe("hover");
  fireEvent.click(zonePath);
  await waitFor(() => expect(zoneRow.getAttribute("data-reach")).toBe("selected"));
  await waitFor(() => expect(handle.page[0].zone).toBe(zone.zone.guid));
  fireEvent.click(roomPath);
  await waitFor(() => expect(roomRow.getAttribute("data-reach")).toBe("selected"));
  await waitFor(() => expect(handle.page[0].room).toBe(room.guid));
  act(() => setHovered(handle.registry, { doc: "other-document", key: elementKey(101) }));
  expect(handle.registry.get(attention("fixture:takeoffs:plan")).hovered.size).toBe(0);
  act(() => handle.page[1]({ zone: "", room: "" }));
  await waitFor(() => expect(zoneRow.getAttribute("data-reach")).toBe("rest"));
  expect(roomRow.getAttribute("data-reach")).toBe("rest");
  view.unmount();
  owner.dispose();
});
