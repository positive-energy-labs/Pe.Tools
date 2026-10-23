// @vitest-environment jsdom
import { act, fireEvent, render, renderHook, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vite-plus/test";
import { createLiveOrbit } from "@pe/kit/lang/live-orbit";
import { PictureStage, useStage, stageViewport, projectBounds } from "./stage-controller";
import { useStageReach } from "./reach";
import { Row } from "@pe/kit/lang/row";
import { revitTarget } from "@pe/kit/lang/revit-target";
import { frame } from "./orbit";
import type { Bounds } from "./types";

vi.mock("./view-history", () => ({ useViewHistory: () => vi.fn() }));
afterEach(() => vi.unstubAllGlobals());

it("plane marks and rows share native identity without route hover handlers", () => {
  const view = render(
    <>
      <Row label="region" revit={[42]} />
      <div data-testid="picture">
        <svg>
          <path {...revitTarget([42])} d="M0 0L1 1" />
        </svg>
      </div>
    </>,
  );
  const stage = renderHook(() => useStageReach(view.getByTestId("picture")));
  const row = view.getByText("region").closest(".dl-row")!;
  const mark = view.container.querySelector("path[data-revit-ids]")!;
  fireEvent.mouseEnter(row);
  expect(mark.getAttribute("data-reach")).toBe("hover");
  fireEvent.mouseLeave(row);
  expect(mark.getAttribute("data-reach")).toBe("rest");
  fireEvent.pointerOver(mark);
  expect(row.getAttribute("data-reach")).toBe("hover");
  fireEvent.pointerLeave(view.getByTestId("picture"));
  expect(row.getAttribute("data-reach")).toBe("rest");
  stage.unmount();
  view.unmount();
});

it("projected bounds use client coordinates and refuse points behind the camera", () => {
  const bounds = { minX: 1, minY: 2, minZ: 0, maxX: 3, maxY: 4, maxZ: 1 };
  expect(projectBounds(bounds, ([x, y]) => [x! * 2, y! * 3], { left: 10, top: 20 })).toEqual(
    new DOMRect(12, 26, 4, 6),
  );
  expect(projectBounds(bounds, () => null, { left: 10, top: 20 })).toBeNull();
});

function StageActions() {
  return useStage().goTo;
}

it("selecting only changes the pivot; F frames at release; Escape clears and keeps the pose", () => {
  const scene: Bounds = { minX: 0, minY: 0, minZ: 0, maxX: 200, maxY: 200, maxZ: 50 };
  const target: Bounds = { minX: 20, minY: 20, minZ: 10, maxX: 30, maxY: 30, maxZ: 20 };
  const initial = frame(scene);
  const publish = vi.fn();
  const orbit = createLiveOrbit(initial, stageViewport(publish));
  const frames: FrameRequestCallback[] = [];
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => frames.push(callback));
  const clearSelection = vi.fn();
  let selectedBounds: Bounds | null = null;
  const view = renderHook(() => useStage(), {
    wrapper: ({ children }) => (
      <PictureStage
        goTo={<span>go to a subject</span>}
        kind="orbit"
        orbit={orbit}
        bounds={{ scene, subject: scene }}
        host={null}
        selectedBounds={selectedBounds}
        clearSelection={clearSelection}
      >
        <StageActions />
        {children}
      </PictureStage>
    ),
  });
  expect(screen.getByText("go to a subject")).toBeTruthy();
  selectedBounds = target;
  view.rerender();
  expect(orbit.read()).toEqual(initial);
  expect(publish).not.toHaveBeenCalled();
  expect(view.result.current.orbitPivot).toEqual([25, 25, 15]);
  const expected = view.result.current.poseOf(target);
  act(() => {
    fireEvent.keyDown(document.body, { key: "f", code: "KeyF" });
  });
  expect(frames.length).toBeGreaterThan(0);
  expect(publish).not.toHaveBeenCalled();
  act(() => {
    for (let time = 0; frames.length; time += 17) frames.shift()!(time);
  });
  expect(orbit.read()).toEqual(expected);
  expect(publish).toHaveBeenLastCalledWith({ viewport: expected }, { history: "push" });
  const framed = orbit.read();
  act(() => {
    fireEvent.keyDown(document.body, { key: "Escape", code: "Escape" });
  });
  expect(clearSelection).toHaveBeenCalledOnce();
  expect(orbit.read()).toEqual(framed);

  selectedBounds = null;
  view.rerender();
  act(() => {
    fireEvent.keyDown(document.body, { key: "f", code: "KeyF" });
  });
  act(() => {
    for (let time = 0; frames.length; time += 17) frames.shift()!(time);
  });
  expect(orbit.read()).toEqual(initial);
  act(() => {
    const gesture = orbit.begin();
    orbit.preview(gesture, { ...initial, yaw: 90 });
    orbit.end(gesture);
  });
  expect(publish).toHaveBeenLastCalledWith(
    { viewport: { ...initial, yaw: 90 } },
    { history: "replace" },
  );
  view.unmount();
});
