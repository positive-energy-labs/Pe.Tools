import { makeAtomRegistry } from "#/route/route-owner";
import { TestAttention } from "#/test-attention";
import { hovered } from "@pe/kit/lang/attention";
import { SubjectTextContext } from "@pe/kit/lang/reach";
import { Row } from "@pe/kit/lang/row";
import { useElementAttention } from "#/attention";
import { createLiveOrbit } from "@pe/kit/lang/live-orbit";
// @vitest-environment jsdom
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { Profiler } from "react";
import { afterEach, expect, test, vi } from "vite-plus/test";

import { OrbitMinimap, PlaneMinimap, globeBody, type OrbitViewport } from "@pe/kit/lang/minimap";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

test("an alias pan/zoom flight does not render the globe, and a stop uses the latest pose", () => {
  const viewport: OrbitViewport = { kind: "orbit", yaw: 30, elev: 30, zoom: 1, pivot: [0, 0, 0] };
  const orbit = createLiveOrbit(viewport, vi.fn());
  const renderGlobe = vi.fn();
  const view = render(
    <Profiler id="globe" onRender={renderGlobe}>
      <OrbitMinimap orbit={orbit} />
    </Profiler>,
  );
  renderGlobe.mockClear();
  const token = orbit.begin();
  const next: OrbitViewport = { ...viewport, zoom: 3, pivot: [10, 20, 0] };
  act(() => {
    orbit.preview(token, { ...next, zoom: 2 });
    orbit.preview(token, next);
  });
  expect(renderGlobe).not.toHaveBeenCalled();
  fireEvent.click(view.container.querySelector('[data-orbit-stop="90/45"]')!);
  expect(orbit.read()).toEqual({ ...next, yaw: 90, elev: 45 });
  expect(renderGlobe).not.toHaveBeenCalled();
});

test("orbit orientation previews move the SVG without React commits or Page publication", async () => {
  const viewport: OrbitViewport = { kind: "orbit", yaw: 30, elev: 30, zoom: 1, pivot: [0, 0, 0] };
  const commit = vi.fn();
  const orbit = createLiveOrbit(viewport, commit);
  const rendered = vi.fn();
  const view = render(
    <Profiler id="globe" onRender={rendered}>
      <OrbitMinimap orbit={orbit} />
    </Profiler>,
  );
  const path = view.container.querySelector('[data-orbit-wire="near"]')!;
  const original = path.getAttribute("d");
  rendered.mockClear();
  const token = orbit.begin();
  act(() => {
    for (let i = 0; i < 20; i++) orbit.preview(token, { ...viewport, yaw: 30 + i * 2, elev: 40 });
  });
  await vi.waitFor(() => expect(path.getAttribute("d")).not.toBe(original));
  expect(rendered).not.toHaveBeenCalled();
  expect(commit).not.toHaveBeenCalled();
  expect(view.container.querySelectorAll("[data-orbit-stop]")).toHaveLength(18);
  act(() => orbit.end(token));
  expect(commit).toHaveBeenCalledTimes(1);
});

test("globe preview uses total displacement before a prop echo and commits only on release", () => {
  const onViewport = vi.fn();
  const viewport: OrbitViewport = { kind: "orbit", yaw: 30, elev: 30, zoom: 1, pivot: [0, 0, 0] };
  const orbit = createLiveOrbit(viewport, onViewport);
  const view = render(<OrbitMinimap orbit={orbit} />);
  const globe = view.getByRole("group", { name: "orbit globe" });
  const pointer = (type: string, x: number) =>
    fireEvent(globe, new MouseEvent(type, { bubbles: true, button: 0, clientX: x, clientY: 10 }));
  pointer("pointerdown", 10);
  pointer("pointermove", 20);
  pointer("pointermove", 30);
  expect(orbit.read()).toEqual({ ...viewport, yaw: 22 });
  expect(onViewport).not.toHaveBeenCalled();
  pointer("pointerup", 30);
  expect(onViewport).toHaveBeenCalledExactlyOnceWith({ ...viewport, yaw: 22 }, "gesture");
  pointer("lostpointercapture", 30);
  expect(onViewport).toHaveBeenCalledTimes(1);
  pointer("pointerdown", 10);
  pointer("pointermove", 20);
  pointer("lostpointercapture", 20);
  expect(orbit.read()).toEqual({ ...viewport, yaw: 22 });
  expect(onViewport).toHaveBeenCalledTimes(1);
});

// A 4000x3000 field thumbnails at 260/4000 = 0.065: a click at (130, 97.5) is field (2000, 1500).
const extent = { width: 4000, height: 3000 };
const viewportSize = { width: 800, height: 600 };

test("a resized plane minimap maps rendered pixels into the field", () => {
  const onViewport = vi.fn();
  const view = render(
    <PlaneMinimap
      viewport={{ kind: "scroll", top: 0, left: 0 }}
      onViewport={onViewport}
      extent={extent}
      viewportSize={viewportSize}
      paint={() => {}}
    />,
  );
  const canvas = view.container.querySelector("canvas")!;
  canvas.getBoundingClientRect = () => new DOMRect(0, 0, 200, 150);
  fireEvent.click(canvas, { clientX: 100, clientY: 75 });
  expect(onViewport).toHaveBeenLastCalledWith({ kind: "scroll", top: 1200, left: 1600 }, "move");
  // A click in the far corner stops at the field's edge.
  fireEvent.click(canvas, { clientX: 200, clientY: 150 });
  expect(onViewport).toHaveBeenLastCalledWith({ kind: "scroll", top: 2400, left: 3200 }, "move");
});

test("a click on a plane minimap centres a plane viewport there at its own scale", () => {
  const onViewport = vi.fn();
  const view = render(
    <PlaneMinimap
      viewport={{ kind: "plane", scale: 2, tx: 0, ty: 0 }}
      onViewport={onViewport}
      extent={extent}
      viewportSize={viewportSize}
      paint={() => {}}
    />,
  );
  fireEvent.click(view.container.querySelector("canvas")!, { clientX: 130, clientY: 97.5 });
  // Field (2000, 1500) lands at screen (400, 300): 2000 * 2 + tx = 400.
  expect(onViewport).toHaveBeenLastCalledWith(
    { kind: "plane", scale: 2, tx: -3600, ty: -2700 },
    "move",
  );
  // The box shows the visible field: 800/2 by 600/2 field units at the thumbnail scale.
  const box = view.container.querySelector<HTMLElement>("[data-minimap-viewport]")!;
  expect([box.style.width, box.style.height]).toEqual(["10%", "10%"]);
});

test("a globe stop click writes that stop's yaw and elevation as a move; below the floor refuses", () => {
  const onViewport = vi.fn();
  const viewport: OrbitViewport = { kind: "orbit", yaw: 30, elev: 30, zoom: 1, pivot: [0, 0, 0] };
  const orbit = createLiveOrbit(viewport, onViewport);
  const view = render(<OrbitMinimap orbit={orbit} />);
  const stop = (id: string) => view.container.querySelector(`[data-orbit-stop="${id}"]`)!;
  expect(view.container.querySelectorAll("[data-orbit-stop]")).toHaveLength(18);
  fireEvent.click(stop("90/45"));
  expect(onViewport).toHaveBeenLastCalledWith({ ...viewport, yaw: 90, elev: 45 }, "move");
  fireEvent.click(stop("pole/90"));
  expect(onViewport).toHaveBeenLastCalledWith({ ...viewport, yaw: 90, elev: 90 }, "move");
  onViewport.mockClear();
  fireEvent.click(stop("0/-45"));
  expect(onViewport).not.toHaveBeenCalled();
  expect(stop("0/-45").hasAttribute("data-refused")).toBe(true);
});

test("the rim N always glides north (eye at 270), keeping elevation, zoom and pivot, with no S marker", async () => {
  vi.useFakeTimers();
  const onViewport = vi.fn();
  const viewport: OrbitViewport = { kind: "orbit", yaw: 30, elev: 30, zoom: 2, pivot: [1, 2, 3] };
  const orbit = createLiveOrbit(viewport, onViewport);
  const end = vi.spyOn(orbit, "end");
  const view = render(<OrbitMinimap orbit={orbit} />);
  expect(view.container.querySelector('[data-orbit-look="S"]')).toBeNull();
  fireEvent.click(view.container.querySelector('[data-orbit-look="N"]')!);
  await act(() => vi.advanceTimersByTimeAsync(1_000));
  expect(onViewport).toHaveBeenCalledTimes(1);
  expect(onViewport).toHaveBeenLastCalledWith({ ...viewport, yaw: 270 }, "move");
  fireEvent.click(view.container.querySelector('[data-orbit-look="N"]')!);
  await act(() => vi.advanceTimersByTimeAsync(1_000));
  expect(end).toHaveBeenCalledTimes(2);
  expect(orbit.read()).toEqual({ ...viewport, yaw: 270 });
  expect(onViewport).toHaveBeenCalledTimes(1);
});

test("the kit row channel lights the globe through the one scene adapter without moving the camera", () => {
  const registry = makeAtomRegistry();
  const viewport: OrbitViewport = { kind: "orbit", yaw: 30, elev: 30, zoom: 1, pivot: [0, 0, 0] };
  const commit = vi.fn();
  const orbit = createLiveOrbit(viewport, commit);
  const line = [
    [
      [0, 0, 0],
      [0.5, 0.5, 0.5],
    ],
  ];
  function Picture() {
    const { hovered } = useElementAttention();
    return <OrbitMinimap orbit={orbit} lines={line} litLines={hovered === 42 ? line : []} />;
  }
  const view = render(
    <TestAttention registry={registry}>
      <SubjectTextContext value={{ doc: "test", nameOf: () => "duct" }}>
        <Row label="duct" revit={[42]} />
        <Picture />
      </SubjectTextContext>
    </TestAttention>,
  );
  const path = view.container.querySelector("[data-orbit-mini-reach]")!;
  expect(path.getAttribute("d")).toBe("");
  fireEvent.pointerOver(view.container.querySelector(".dl-row")!);
  expect(path.getAttribute("d")).toContain("L");
  expect(registry.get(hovered)?.key).toBe("e:42");
  fireEvent.pointerOver(view.container.firstElementChild!);
  expect(path.getAttribute("d")).toBe("");
  expect(orbit.read()).toEqual(viewport);
  expect(commit).not.toHaveBeenCalled();
});

test("perspective puts the globe's silhouette on the rim and parallel keeps the old projection", () => {
  const t = Math.PI / 6; // yaw 30°, elev 30°
  const eye = [Math.cos(t) * Math.cos(t), Math.sin(t) * Math.cos(t), Math.sin(t)];
  const side = [-Math.sin(t), Math.cos(t), 0];
  const radius = (body: ReturnType<typeof globeBody>, p: number[]) => {
    const [cx, cy] = body.at([0, 0, 0]);
    const [x, y] = body.at(p);
    return Math.hypot(x - cx, y - cy);
  };
  const parallel = globeBody(30, 30, "parallel");
  const perspective = globeBody(30, 30, "perspective");
  // Parallel: the point 90° from the eye is the silhouette, on the radius-92 rim.
  expect(radius(parallel, side)).toBeCloseTo(92, 6);
  // Perspective: that point falls inside, and the tangent point (dot = 1/3) is the rim instead.
  expect(radius(perspective, side)).toBeLessThan(91);
  const lat = Math.sqrt(1 - 1 / 9);
  expect(
    radius(
      perspective,
      eye.map((e, i) => e / 3 + side[i]! * lat),
    ),
  ).toBeCloseTo(92, 6);
});

test("selected lines draw the select underlay; none draws nothing", () => {
  const orbit = createLiveOrbit(
    { kind: "orbit", yaw: 30, elev: 30, zoom: 1, pivot: [0, 0, 0] },
    vi.fn(),
  );
  const line = [
    [
      [0, 0, 0],
      [0.5, 0.5, 0.5],
    ],
  ];
  const view = render(<OrbitMinimap orbit={orbit} lines={line} selectedLines={line} />);
  const path = () => view.container.querySelector("[data-orbit-mini-selected]")!.getAttribute("d");
  expect(path()).toContain("L");
  view.rerender(<OrbitMinimap orbit={orbit} lines={line} />);
  expect(path()).toBe("");
});
