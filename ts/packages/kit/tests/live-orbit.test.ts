import { expect, test, vi } from "vite-plus/test";
import { createLiveOrbit, flyTo } from "@pe/kit/lang/live-orbit";
import { viewportCodec } from "@pe/agent-contracts";
import type { OrbitViewport } from "@pe/agent-contracts";

const initial: OrbitViewport = { kind: "orbit", yaw: 0, elev: 30, zoom: 1, pivot: [0, 0, 0] };
test("a click nudge publishes nothing; a released drag beyond three pixels publishes once", () => {
  const commit = vi.fn();
  const orbit = createLiveOrbit(initial, commit);
  for (const delta of [
    { yaw: 0.1 },
    { zoom: 1.001 },
    { pivot: [0.1, 0, 0] as [number, number, number] },
  ]) {
    const token = orbit.begin(600, 100);
    orbit.preview(token, { ...initial, ...delta });
    orbit.end(token);
    expect(commit).not.toHaveBeenCalled();
    expect(orbit.read()).toEqual(initial);
  }
  const token = orbit.begin(600, 100);
  const pose = { ...initial, pivot: [1, 0, 0] as [number, number, number] };
  orbit.preview(token, pose);
  orbit.end(token);
  orbit.end(token);
  expect(commit).toHaveBeenCalledExactlyOnceWith(pose, "gesture");
});
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

/** A frame clock: `run(ms)` steps 16 ms frames; `stall(ms)` delivers one frame after a gap. */
function frames() {
  const queue: FrameRequestCallback[] = [];
  vi.stubGlobal("requestAnimationFrame", (f: FrameRequestCallback) => queue.push(f));
  let now = 0;
  const frame = () => queue.splice(0).forEach((f) => f(now));
  return {
    queue,
    run: (ms: number) => {
      for (const end = now + ms; now < end; now += 16) frame();
    },
    stall: (ms: number) => {
      now += ms;
      frame();
    },
  };
}

test("a flight eases from the current camera, commits once, and yields to new input", () => {
  const { queue, run } = frames();
  try {
    const commit = vi.fn();
    const orbit = createLiveOrbit(initial, commit);
    const to = { ...initial, zoom: 4, pivot: [10, 20, 30] as [number, number, number] };
    flyTo(orbit, to);
    expect(orbit.read()).toEqual(initial);
    run(200);
    expect(orbit.read()!.zoom).toBeGreaterThan(1);
    expect(orbit.read()!.zoom).toBeLessThan(4);
    expect(commit).not.toHaveBeenCalled();
    run(800);
    expect(orbit.read()).toEqual(to);
    expect(commit).toHaveBeenCalledExactlyOnceWith(to, "move");
    commit.mockClear();
    flyTo(orbit, initial);
    const input = orbit.begin();
    const dragged = { ...to, yaw: 15 };
    orbit.preview(input, dragged);
    run(100);
    expect(orbit.read()).toEqual(dragged);
    expect(queue).toHaveLength(0);
    expect(commit).not.toHaveBeenCalled();
  } finally {
    vi.unstubAllGlobals();
  }
});

test("a long hop rises until both ends share the view, and a restore lands without a commit", () => {
  const { run } = frames();
  try {
    const commit = vi.fn();
    const near = { ...initial, zoom: 8, pivot: [0, 0, 0] as [number, number, number] };
    const orbit = createLiveOrbit(near, commit);
    const scene = { minX: -100, maxX: 100, minY: -100, maxY: 100, minZ: 0, maxZ: 10 };
    const far = { ...near, pivot: [150, 0, 0] as [number, number, number] };
    let landed = false;
    flyTo(orbit, far, { history: null, scene, onLand: () => (landed = true) });
    run(260);
    // Mid-flight the camera is wider than either end, so origin and destination are both in view.
    expect(orbit.read()!.zoom).toBeLessThan(8 / 4);
    run(1000);
    expect(orbit.read()).toEqual(far);
    expect(landed).toBe(true);
    expect(commit).not.toHaveBeenCalled();
  } finally {
    vi.unstubAllGlobals();
  }
});

test("a main-thread stall delays a flight instead of skipping it", () => {
  const { run, stall } = frames();
  try {
    const orbit = createLiveOrbit(initial, vi.fn());
    const to = { ...initial, pivot: [10, 0, 0] as [number, number, number] };
    flyTo(orbit, to);
    run(16);
    stall(1100);
    expect(orbit.read()!.pivot[0]).toBeGreaterThan(0);
    expect(orbit.read()!.pivot[0]).toBeLessThan(5);
    run(1000);
    expect(orbit.read()).toEqual(to);
  } finally {
    vi.unstubAllGlobals();
  }
});

test("an intentional small flight replaces history without the gesture dead-band", () => {
  const { run } = frames();
  try {
    const commit = vi.fn();
    const orbit = createLiveOrbit({ ...initial, projection: "parallel" }, commit);
    const to = { ...initial, yaw: 0.1, projection: "parallel" as const };
    flyTo(orbit, to, { history: "replace" });
    run(1000);
    expect(orbit.read()).toEqual(to);
    expect(commit).toHaveBeenCalledExactlyOnceWith(to, "gesture");
  } finally {
    vi.unstubAllGlobals();
  }
});

test("a second flight retargets from mid-air and only the last lands", () => {
  const { run } = frames();
  try {
    const commit = vi.fn();
    const orbit = createLiveOrbit(initial, commit);
    const a = { ...initial, pivot: [10, 0, 0] as [number, number, number] };
    const b = { ...initial, pivot: [0, 10, 0] as [number, number, number] };
    flyTo(orbit, a, { history: "replace" });
    run(150);
    const mid = orbit.read()!;
    flyTo(orbit, b, { history: "replace" });
    run(32);
    // Leaving at speed: the retarget's first frames already move toward b.
    expect(orbit.read()!.pivot[1]).toBeGreaterThan(mid.pivot[1] + 0.1);
    run(1000);
    expect(orbit.read()).toEqual(b);
    expect(commit).toHaveBeenCalledExactlyOnceWith(b, "gesture");
  } finally {
    vi.unstubAllGlobals();
  }
});

test("a codec-rounded Page echo does not fly or cancel a newer gesture", () => {
  const orbit = createLiveOrbit(initial, vi.fn());
  const saved = {
    ...initial,
    yaw: 12.123456,
    zoom: 0.502800733,
    pivot: [381.352081, 674.761963, -6.421773] as [number, number, number],
  };
  const first = orbit.begin();
  orbit.preview(first, saved);
  orbit.end(first);
  const newer = orbit.begin();
  const live = { ...saved, yaw: 25 };
  orbit.preview(newer, live);
  const fly = vi.fn();
  orbit.accept(viewportCodec.decode(viewportCodec.encode(saved)) as OrbitViewport, fly);
  expect(fly).not.toHaveBeenCalled();
  expect(orbit.read()).toBe(live);
  expect(orbit.owns(newer)).toBe(true);
});

test("a rounded URL projection after the exact Page acknowledgement stays still", () => {
  const orbit = createLiveOrbit(initial, vi.fn());
  const saved = { ...initial, yaw: 12.123456, zoom: 0.502800733 };
  orbit.move(saved);
  orbit.accept(saved);
  const fly = vi.fn();
  orbit.accept(viewportCodec.decode(viewportCodec.encode(saved)) as OrbitViewport, fly);
  expect(fly).not.toHaveBeenCalled();
  expect(orbit.read()).toBe(saved);
});
