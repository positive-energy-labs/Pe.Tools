// @vitest-environment jsdom
import { act, render } from "@testing-library/react";
import { expect, it, vi } from "vite-plus/test";
import { SceneMeshes } from "./types";
import type { OrbitViewport } from "./orbit";
import { Scene3D } from "./scene3d";

const renderer = vi.hoisted(() => ({ current: null as any }));
vi.mock("./renderer", () => ({ createRenderer: () => renderer.current }));
vi.mock("#/revit/observation", () => ({ useNativeObservation: () => ({ scope: null }) }));

it("keeps motion local, publishes on release and accepts external camera moves", () => {
  vi.stubGlobal("requestAnimationFrame", (frame: FrameRequestCallback) => {
    frame(0);
    return 1;
  });
  const moves = new EventTarget();
  const initial: OrbitViewport = { kind: "orbit", yaw: 30, elev: 30, zoom: 1, pivot: [0, 0, 0] };
  let pose = initial;
  const setViewport = vi.fn();
  renderer.current = {
    canvas: document.createElement("canvas"),
    moves,
    plane: () => null,
    viewport: () => pose,
    setViewport,
    setOnFrame: vi.fn(),
    setPlane: vi.fn(),
    setThumbs: vi.fn(),
    paint: vi.fn(),
    setLayers: vi.fn(),
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
  const view = render(<Scene3D meshes={meshes} viewport={initial} onViewport={onViewport} />);
  act(() => {
    moves.dispatchEvent(new Event("start"));
    for (let yaw = 31; yaw <= 60; yaw++) {
      pose = { ...initial, yaw };
      moves.dispatchEvent(new Event("change"));
    }
  });
  expect(onViewport).not.toHaveBeenCalled();
  act(() => {
    moves.dispatchEvent(new Event("end"));
  });
  expect(onViewport).toHaveBeenCalledExactlyOnceWith(pose, "gesture");
  setViewport.mockClear();
  view.rerender(<Scene3D meshes={meshes} viewport={{ ...pose }} onViewport={onViewport} />);
  expect(setViewport).not.toHaveBeenCalled();
  const external = { ...pose, yaw: 90 };
  view.rerender(<Scene3D meshes={meshes} viewport={external} onViewport={onViewport} />);
  expect(setViewport).toHaveBeenCalledExactlyOnceWith(external);
  vi.useFakeTimers();
  onViewport.mockClear();
  act(() => {
    for (let zoom = 2; zoom <= 10; zoom++) {
      renderer.current.canvas.dispatchEvent(new WheelEvent("wheel"));
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
  view.unmount();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
