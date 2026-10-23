// @vitest-environment jsdom
import { act, fireEvent, render } from "@testing-library/react";
import { expect, it, vi } from "vite-plus/test";
import { SceneMeshes } from "./types";
import type { OrbitViewport } from "./orbit";
import { createLiveOrbit } from "@pe/kit/lang/live-orbit";
import { OrbitMinimap } from "@pe/kit/lang/minimap";
import { Scene3D } from "./scene3d";

const renderer = vi.hoisted(() => ({ current: null as any }));
vi.mock("./renderer", () => ({
  createRenderer: (host: HTMLElement) => {
    host.prepend(renderer.current.canvas);
    return renderer.current;
  },
}));
vi.mock("#/revit/observation", () => ({ useNativeObservation: () => ({ scope: null }) }));

it("keeps motion local, publishes on release and accepts external camera moves", () => {
  vi.stubGlobal("requestAnimationFrame", (frame: FrameRequestCallback) => {
    frame(0);
    return 1;
  });
  const moves = new EventTarget();
  const initial: OrbitViewport = { kind: "orbit", yaw: 30, elev: 30, zoom: 1, pivot: [0, 0, 0] };
  let pose = initial;
  const setViewport = vi.fn((next: OrbitViewport) => {
    pose = next;
  });
  renderer.current = {
    canvas: document.createElement("canvas"),
    moves,
    plane: () => null,
    viewport: () => pose,
    setViewport,
    setOrbitPivot: vi.fn(),
    setOnFrame: vi.fn(),
    reportFrame: vi.fn(),
    setPlane: vi.fn(),
    setThumbs: vi.fn(),
    paint: vi.fn(),
    setLayers: vi.fn(),
    lightIssue: vi.fn(),
    pickIssue: () => null,
    setClip: vi.fn(),
    dispose: vi.fn(),
  };
  const meshes = new SceneMeshes(
    new Float32Array(9),
    {
      minX: -1,
      minY: -1,
      minZ: -1,
      maxX: 1,
      maxY: 1,
      maxZ: 1,
    },
    [],
  );
  const onViewport = vi.fn();
  const onPick = vi.fn();
  const orbit = createLiveOrbit(initial, onViewport);
  const view = render(
    <>
      <Scene3D readout={<span>picture state</span>} meshes={meshes} orbit={orbit} onPick={onPick} />
      <OrbitMinimap orbit={orbit} />
    </>,
  );
  expect(view.getByText("picture state")).toBeTruthy();
  const globe = view.getByRole("group", { name: "orbit globe" });
  const initialGlobe = globe.innerHTML;
  act(() => {
    moves.dispatchEvent(new Event("start"));
    for (let yaw = 31; yaw <= 60; yaw++) {
      pose = { ...initial, yaw };
      moves.dispatchEvent(new Event("change"));
    }
  });
  expect(onViewport).not.toHaveBeenCalled();
  expect(orbit.read()).toEqual(pose);
  expect(globe.innerHTML).not.toEqual(initialGlobe);
  act(() => {
    moves.dispatchEvent(new Event("end"));
  });
  expect(onViewport).toHaveBeenCalledExactlyOnceWith(pose, "gesture");
  setViewport.mockClear();
  act(() => orbit.accept({ ...pose }));
  expect(setViewport).not.toHaveBeenCalled();
  const external = { ...pose, yaw: 90 };
  act(() => orbit.accept(external));
  expect(setViewport).toHaveBeenCalledExactlyOnceWith(external);
  vi.useFakeTimers();
  onViewport.mockClear();
  act(() => {
    for (let zoom = 2; zoom <= 10; zoom++) {
      renderer.current.canvas.dispatchEvent(new WheelEvent("wheel", { bubbles: true }));
      moves.dispatchEvent(new Event("start"));
      pose = { ...external, zoom };
      moves.dispatchEvent(new Event("change"));
      moves.dispatchEvent(new Event("end"));
      vi.advanceTimersByTime(30);
    }
  });
  expect(onViewport).not.toHaveBeenCalled();
  act(() => {
    vi.advanceTimersByTime(150);
  });
  expect(onViewport).toHaveBeenCalledExactlyOnceWith(pose, "gesture");
  // The other input drives the same renderer immediately, without a Page prop round trip.
  onViewport.mockClear();
  setViewport.mockClear();
  const from = orbit.read()!;
  const pointer = (type: string, x: number) =>
    fireEvent(globe, new MouseEvent(type, { bubbles: true, button: 0, clientX: x, clientY: 10 }));
  pointer("pointerdown", 10);
  pointer("pointermove", 30);
  const turned = { ...from, yaw: from.yaw - 8 };
  expect(setViewport).toHaveBeenCalledExactlyOnceWith(turned);
  expect(onViewport).not.toHaveBeenCalled();
  pointer("pointerup", 30);
  expect(onViewport).toHaveBeenCalledExactlyOnceWith(turned, "gesture");
  act(() => orbit.accept({ ...turned }));
  expect(setViewport).toHaveBeenCalledTimes(1);
  const beforeSelection = orbit.read();
  setViewport.mockClear();
  view.rerender(
    <>
      <Scene3D
        readout={null}
        meshes={meshes}
        orbit={orbit}
        onPick={onPick}
        orbitPivot={[10, 20, 30]}
      />
      <OrbitMinimap orbit={orbit} />
    </>,
  );
  expect(renderer.current.setOrbitPivot).toHaveBeenLastCalledWith([10, 20, 30]);
  expect(orbit.read()).toBe(beforeSelection);
  expect(setViewport).not.toHaveBeenCalled();
  const canvas = renderer.current.canvas;
  fireEvent(canvas, new MouseEvent("pointerdown", { button: 0, clientX: 10, clientY: 10 }));
  fireEvent(canvas, new MouseEvent("pointerup", { button: 0, clientX: 10, clientY: 10 }));
  expect(onPick).not.toHaveBeenCalled();
  fireEvent.click(canvas, { button: 0, clientX: 10, clientY: 10 });
  expect(onPick).toHaveBeenCalledExactlyOnceWith(null, expect.any(MouseEvent));
  view.unmount();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
