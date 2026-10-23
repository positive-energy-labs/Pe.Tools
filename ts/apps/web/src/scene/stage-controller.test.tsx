// @vitest-environment jsdom
import { act, fireEvent, renderHook } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vite-plus/test";
import { createLiveOrbit } from "./live-orbit";
import { useStage, stageViewport } from "./stage-controller";
import { frame } from "./orbit";
import type { Bounds } from "./types";

vi.mock("./view-history", () => ({ useViewHistory: () => vi.fn() }));
afterEach(() => vi.unstubAllGlobals());

it("selecting only changes the pivot; F frames at release; Escape clears and keeps the pose", () => {
  const scene: Bounds = { minX: 0, minY: 0, minZ: 0, maxX: 200, maxY: 200, maxZ: 50 };
  const target: Bounds = { minX: 20, minY: 20, minZ: 10, maxX: 30, maxY: 30, maxZ: 20 };
  const initial = frame(scene);
  const publish = vi.fn();
  const orbit = createLiveOrbit(initial, stageViewport(publish));
  const frames: FrameRequestCallback[] = [];
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => frames.push(callback));
  const clearSelection = vi.fn();
  const view = renderHook(
    ({ selectedBounds }: { selectedBounds: Bounds | null }) =>
      useStage({
        goTo: null,
        kind: "orbit",
        orbit,
        bounds: { scene, subject: scene },
        host: null,
        selectedBounds,
        clearSelection,
      }),
    { initialProps: { selectedBounds: null as Bounds | null } },
  );

  view.rerender({ selectedBounds: target });
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

  view.rerender({ selectedBounds: null });
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
