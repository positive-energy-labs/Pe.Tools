import { makeAtomRegistry } from "#/route/route-owner";
import { TestAttention } from "#/test-attention";
// @vitest-environment jsdom
import { act, fireEvent, render } from "@testing-library/react";
import { expect, it, vi } from "vite-plus/test";
import { SceneMeshes } from "./types";
import { type OrbitViewport } from "./orbit";
import { createLiveOrbit } from "@pe/kit/lang/live-orbit";
import { OrbitMinimap } from "@pe/kit/lang/minimap";
import { Scene3D } from "./scene3d";
import { usePictureRead } from "#/scene/picture/read";
import type { SceneRead } from "./use-scene";
import { Row } from "@pe/kit/lang/row";
import type { Pick, PaintOf } from "./types";
import type { ContextMode } from "./renderer";

const picking = vi.hoisted(() => ({ current: null as Pick | null }));
vi.mock("./picking", async (original) => ({
  ...(await original<typeof import("./picking")>()),
  pickAt: () => picking.current,
}));

const renderer = vi.hoisted(() => ({ current: null as any }));
vi.mock("./preparation", () => ({ prepareScene: async () => ({ geometry: {}, release() {} }) }));
vi.mock("./renderer", () => ({
  createRenderer: (host: HTMLElement, initial: SceneMeshes) => {
    let held = initial;
    renderer.current.meshes = () => held;
    renderer.current.clear = vi.fn(() => {
      held = new SceneMeshes(new Float32Array(), initial.bounds, []);
    });
    let frame = initial.bounds;
    renderer.current.frameBounds = () => frame;
    renderer.current.setFrameBounds = vi.fn((next) => {
      frame = next;
    });
    renderer.current.stage = vi.fn(async (plan) => ({
      commit() {
        held = plan.meshes;
      },
      release() {},
    }));
    host.prepend(renderer.current.canvas);
    return renderer.current;
  },
}));
vi.mock("#/revit/observation", () => ({ useNativeObservation: () => ({ scope: null }) }));

it("keeps camera gestures local and the viewport mounted across membership and native re-reads", async () => {
  const frames: FrameRequestCallback[] = [];
  vi.stubGlobal("requestAnimationFrame", (frame: FrameRequestCallback) => frames.push(frame));
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
    gestureSize: () => [600, 2],
    setViewport,
    limitViewport: (v: OrbitViewport) => v,
    recoverViewport: vi.fn(),
    ...Object.fromEntries(
      "setOrbitPivot setOnFrame reportFrame setPlane setThumbs paint setLayers lightIssue reach hoverElement setClip setLook setAppearance setContextMode setHues clear"
        .split(" ")
        .map((name) => [name, vi.fn()]),
    ),
    pickIssue: () => null,
    dispose: vi.fn(() => renderer.current.canvas.remove()),
  };
  const meshes = new SceneMeshes(
    new Float32Array(9),
    { minX: -1, minY: -1, minZ: -1, maxX: 1, maxY: 1, maxZ: 1 },
    [
      {
        key: "mesh42",
        revitId: 42,
        uniqueId: "uid42",
        documentKey: "doc",
        linkInstanceId: null,
        category: "test",
        categoryId: null,
        focus: true,
        firstVertex: 0,
        vertexCount: 3,
      },
    ],
  );
  const onViewport = vi.fn();
  const onPick = vi.fn();
  const orbit = createLiveOrbit(initial, onViewport);
  const draw = (
    pivot?: readonly number[],
    contextMode?: ContextMode,
    shown = meshes,
    pickingEnabled = true,
    paintOf?: PaintOf,
  ) => (
    <>
      <Scene3D
        readout={<span>picture state</span>}
        meshes={shown}
        orbit={orbit}
        onPick={onPick}
        pickingEnabled={pickingEnabled}
        paintOf={paintOf}
        orbitPivot={pivot}
        contextMode={contextMode}
      />
      <OrbitMinimap orbit={orbit} />
      <Row label="linked row" revit={[42]} />
    </>
  );
  const registry = makeAtomRegistry();
  const view = render(<TestAttention registry={registry}>{draw()}</TestAttention>);
  await act(async () => {});
  expect(renderer.current.setContextMode).toHaveBeenLastCalledWith(undefined);
  expect(view.getByText("picture state")).toBeTruthy();
  const row = view.getByText("linked row").closest(".dl-row")!;
  fireEvent.pointerOver(row);
  expect(renderer.current.paint.mock.lastCall[3]).toEqual(new Set(["mesh42"]));
  fireEvent.pointerOver(view.container.firstElementChild!);
  expect(renderer.current.paint.mock.lastCall[3]).toEqual(new Set());
  picking.current = { instance: meshes.instances[0]!, point: [0, 0, 0] };
  fireEvent.pointerMove(renderer.current.canvas);
  act(() => frames.splice(0).forEach((frame) => frame(0)));
  expect(row.getAttribute("data-reach")).toBe("hover");
  fireEvent.pointerLeave(renderer.current.canvas);
  expect(row.getAttribute("data-reach")).toBe("rest");
  picking.current = null;
  const globe = view.getByRole("group", { name: "orbit globe" });
  const initialGlobe = globe.innerHTML;
  act(() => {
    moves.dispatchEvent(new Event("start"));
    for (let yaw = 31; yaw <= 60; yaw++) {
      pose = { ...initial, yaw };
      moves.dispatchEvent(new Event("change"));
    }
    frames.splice(0).forEach((frame) => frame(0));
  });
  expect(onViewport).not.toHaveBeenCalled();
  expect(orbit.read()).toEqual(pose);
  expect(globe.innerHTML).not.toEqual(initialGlobe);
  act(() => void moves.dispatchEvent(new Event("end")));
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
  act(() => void vi.advanceTimersByTime(150));
  expect(onViewport).toHaveBeenCalledExactlyOnceWith(pose, "gesture");
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
  view.rerender(<TestAttention registry={registry}>{draw([10, 20, 30])}</TestAttention>);
  expect(renderer.current.setOrbitPivot).toHaveBeenLastCalledWith([10, 20, 30]);
  expect(orbit.read()).toBe(beforeSelection);
  expect(setViewport).not.toHaveBeenCalled();
  const canvas = renderer.current.canvas;
  view.rerender(<TestAttention registry={registry}>{draw([10, 20, 30], "lines")}</TestAttention>);
  expect(renderer.current.setContextMode).toHaveBeenLastCalledWith("lines");
  expect(renderer.current.canvas).toBe(canvas);
  view.rerender(<TestAttention registry={registry}>{draw([10, 20, 30], "glass")}</TestAttention>);
  expect(renderer.current.setContextMode).toHaveBeenLastCalledWith("glass");
  fireEvent(canvas, new MouseEvent("pointerdown", { button: 0, clientX: 10, clientY: 10 }));
  onViewport.mockClear();
  act(() => {
    moves.dispatchEvent(new Event("start"));
    pose = { ...orbit.read()!, yaw: orbit.read()!.yaw + 4 };
    moves.dispatchEvent(new Event("change"));
    fireEvent(canvas, new MouseEvent("pointerup", { button: 0, clientX: 14, clientY: 10 }));
    moves.dispatchEvent(new Event("end"));
  });
  expect(onViewport).not.toHaveBeenCalled();
  expect(orbit.read()).toBe(beforeSelection);
  fireEvent(canvas, new MouseEvent("pointerdown", { button: 0, clientX: 10, clientY: 10 }));
  fireEvent(canvas, new MouseEvent("pointerup", { button: 0, clientX: 10, clientY: 10 }));
  expect(onPick).not.toHaveBeenCalled();
  fireEvent.click(canvas, { button: 0, clientX: 10, clientY: 10 });
  expect(onPick).toHaveBeenCalledExactlyOnceWith(null, expect.any(MouseEvent));
  view.rerender(
    <TestAttention registry={registry}>{draw(undefined, "glass", meshes, false)}</TestAttention>,
  );
  fireEvent.click(canvas, { button: 0, clientX: 10, clientY: 10 });
  expect(onPick).toHaveBeenCalledTimes(1);
  const touch = (type: string, pointerId: number, clientX: number) =>
    fireEvent(
      canvas,
      Object.assign(new MouseEvent(type, { button: 0, clientX, clientY: 10 }), { pointerId }),
    );
  act(() => {
    touch("pointerdown", 1, 10);
    touch("pointerdown", 2, 14);
    moves.dispatchEvent(new Event("start"));
    pose = { ...orbit.read()!, zoom: orbit.read()!.zoom * 2 };
    moves.dispatchEvent(new Event("change"));
    touch("pointerup", 2, 14);
    touch("pointerup", 1, 10);
    moves.dispatchEvent(new Event("end"));
  });
  expect(onViewport).toHaveBeenCalledExactlyOnceWith(pose, "gesture");
  // A withheld pick never withholds camera gestures on the retained picture.
  view.rerender(<TestAttention registry={registry}>{draw()}</TestAttention>);
  const biggerCapture = new SceneMeshes(
    meshes.positions,
    { minX: -100, minY: -100, minZ: -100, maxX: 100, maxY: 100, maxZ: 100 },
    meshes.instances,
  );
  view.rerender(
    <TestAttention registry={registry}>{draw(undefined, "glass", biggerCapture)}</TestAttention>,
  );
  await act(async () => {});
  expect(renderer.current.meshes()).toBe(biggerCapture);
  expect(renderer.current.canvas).toBe(canvas);
  expect(renderer.current.dispose).not.toHaveBeenCalled();
  // Cancellation/failure ownership is tested at the controller boundary; this test exercises
  // the viewport's actual gesture/retained-native-authority wiring.
  view.rerender(<TestAttention registry={registry}>{draw()}</TestAttention>);
  await act(async () => {});
  expect(renderer.current.meshes()).toBe(meshes);
  view.unmount();
  type PictureProps = { capture: SceneRead; document?: string };
  function Picture({ capture, document = "native/doc" }: PictureProps) {
    const { read } = usePictureRead(capture, document, "SA 71", !capture.meshes && !capture.error);
    return (
      <div data-reading={read.pending ? "pending" : undefined}>
        <Scene3D readout={null} meshes={read.meshes} orbit={orbit} />
      </div>
    );
  }
  const capture: SceneRead = {
    meshes,
    pending: false,
    error: null,
    omittedElements: 3,
    unavailableElements: 1,
    completeness: {
      complete: false,
      deferredCandidates: 0,
      acquisitionLimitedElements: 0,
      limitReason: "output-budget",
    },
  };
  const picture = render(<Picture capture={capture} />);
  await act(async () => {});
  const drawn = picture.container.querySelector("canvas");
  renderer.current.dispose.mockClear();
  for (const pending of [false, true]) {
    picture.rerender(<Picture capture={{ ...capture, meshes: null, pending }} />);
    expect(picture.container.querySelectorAll("canvas")).toHaveLength(1);
    expect(picture.container.querySelector("canvas")).toBe(drawn);
    expect(picture.container.firstElementChild?.getAttribute("data-reading")).toBe("pending");
    expect(renderer.current.dispose).not.toHaveBeenCalled();
  }
  picture.rerender(<Picture capture={{ ...capture, meshes: null, error: "capture failed" }} />);
  expect(picture.container.querySelector("canvas")).toBe(drawn);
  expect(picture.container.firstElementChild?.hasAttribute("data-reading")).toBe(false);
  const replacement = new SceneMeshes(meshes.positions, meshes.bounds, meshes.instances);
  picture.rerender(<Picture capture={{ ...capture, meshes: replacement }} />);
  expect(picture.container.querySelectorAll("canvas")).toHaveLength(1);
  expect(picture.container.firstElementChild?.hasAttribute("data-reading")).toBe(false);
  await act(async () => {});
  expect(renderer.current.dispose).not.toHaveBeenCalled();
  picture.rerender(
    <Picture capture={{ ...capture, meshes: null, pending: true }} document="native/other" />,
  );
  expect(picture.container.querySelector("canvas")?.hidden).toBe(true);
  await act(async () => {});
  expect(renderer.current.meshes().instances).toHaveLength(0);
  picture.unmount();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
