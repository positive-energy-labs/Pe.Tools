import { expect, test, vi } from "vite-plus/test";
import { createLiveOrbit, glideTo } from "./live-orbit";
import type { OrbitViewport } from "./orbit";

const initial: OrbitViewport = { kind: "orbit", yaw: 0, elev: 30, zoom: 1, pivot: [0, 0, 0] };
test("all subscribers see motion; releasing and acknowledging never replay a camera pose", () => {
  const commit = vi.fn();
  const orbit = createLiveOrbit(initial, commit);
  const canvas = vi.fn(),
    globe = vi.fn();
  orbit.subscribe(canvas);
  orbit.subscribe(globe);
  const gesture = orbit.begin();
  const final = { ...initial, yaw: 45 };
  orbit.preview(gesture, final);
  expect(canvas).toHaveBeenCalledTimes(1);
  expect(globe).toHaveBeenCalledTimes(1);
  expect(commit).not.toHaveBeenCalled();
  orbit.end(gesture);
  expect(commit).toHaveBeenCalledExactlyOnceWith(final, "gesture");
  orbit.accept({ ...final });
  expect(canvas).toHaveBeenCalledTimes(1);
  expect(globe).toHaveBeenCalledTimes(1);
});

test("a delayed Page echo cannot roll back a newer gesture", () => {
  const orbit = createLiveOrbit(initial, vi.fn());
  const first = orbit.begin();
  const saved = { ...initial, yaw: 45 };
  orbit.preview(first, saved);
  orbit.end(first);
  const second = orbit.begin();
  const live = { ...initial, yaw: 60 };
  orbit.preview(second, live);
  orbit.accept(saved);
  expect(orbit.read()).toEqual(live);
  expect(orbit.owns(second)).toBe(true);
});

test("external moves and replacement gestures invalidate late input; cancellation restores without committing", () => {
  const commit = vi.fn();
  const orbit = createLiveOrbit(initial, commit);
  const old = orbit.begin();
  orbit.preview(old, { ...initial, yaw: 20 });
  const external = { ...initial, yaw: 90 };
  orbit.accept(external);
  orbit.preview(old, initial);
  orbit.end(old);
  orbit.cancel(old);
  expect(orbit.read()).toEqual(external);
  expect(commit).not.toHaveBeenCalled();
  const first = orbit.begin();
  const second = orbit.begin();
  orbit.preview(first, initial);
  expect(orbit.read()).toEqual(external);
  orbit.preview(second, initial);
  orbit.cancel(second);
  expect(orbit.read()).toEqual(external);
  expect(commit).not.toHaveBeenCalled();
});

test("a frame eases from the current camera, commits once, and yields to new input", () => {
  let now = 0;
  const frames: FrameRequestCallback[] = [];
  vi.spyOn(performance, "now").mockImplementation(() => now);
  vi.stubGlobal("requestAnimationFrame", (f: FrameRequestCallback) => frames.push(f));
  const tick = (at: number) => {
    now = at;
    frames.shift()!(at);
  };
  try {
    const commit = vi.fn();
    const orbit = createLiveOrbit(initial, commit);
    const to = { ...initial, zoom: 4, pivot: [10, 20, 30] as [number, number, number] };
    glideTo(orbit, to, 100);
    expect(orbit.read()).toEqual(initial);
    tick(50);
    expect(orbit.read()!.zoom).toBeGreaterThan(1);
    expect(orbit.read()!.zoom).toBeLessThan(4);
    expect(commit).not.toHaveBeenCalled();
    tick(100);
    expect(orbit.read()).toEqual(to);
    expect(commit).toHaveBeenCalledExactlyOnceWith(to, "move");
    commit.mockClear();
    glideTo(orbit, initial, 100);
    const input = orbit.begin();
    const dragged = { ...to, yaw: 15 };
    orbit.preview(input, dragged);
    tick(150);
    expect(orbit.read()).toEqual(dragged);
    expect(frames).toHaveLength(0);
    expect(commit).not.toHaveBeenCalled();
  } finally {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  }
});
