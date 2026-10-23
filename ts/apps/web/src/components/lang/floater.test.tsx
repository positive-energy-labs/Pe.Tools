// @vitest-environment jsdom
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vite-plus/test";

import { createLiveOrbit } from "#/scene/live-orbit";
import { Floater, type FloaterSpec } from "./floater";
import { OrbitMinimap, type OrbitViewport } from "./minimap";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const viewport: OrbitViewport = { kind: "orbit", yaw: 30, elev: 30, zoom: 1, pivot: [0, 0, 0] };
const pointer = (el: Element, type: string, x: number, y: number) =>
  fireEvent(el, new MouseEvent(type, { bubbles: true, button: 0, clientX: x, clientY: y }));

function setup(size?: FloaterSpec["size"]) {
  const onViewport = vi.fn();
  const orbit = createLiveOrbit(viewport, onViewport);
  const outerPointer = vi.fn();
  const view = render(
    <div onPointerDown={outerPointer} onPointerMove={outerPointer} onPointerUp={outerPointer}>
      <Floater
        spec={{
          key: "globe",
          label: "globe",
          place: "tr",
          size,
          open: true,
          onOpenChange: vi.fn(),
          render: () => <OrbitMinimap orbit={orbit} />,
        }}
      />
    </div>,
  );
  const floater = view.getByRole("region", { name: "globe" });
  vi.spyOn(floater.parentElement!, "getBoundingClientRect").mockReturnValue(
    new DOMRect(0, 0, 600, 600),
  );
  const rect = vi
    .spyOn(floater, "getBoundingClientRect")
    .mockReturnValue(new DOMRect(360, 10, 230, 230));
  const grip = view.getByLabelText("move globe");
  const resize = view.getByLabelText("resize globe");
  grip.setPointerCapture = resize.setPointerCapture = vi.fn();
  return { view, orbit, onViewport, outerPointer, floater, rect, grip, resize };
}

test("a floater without size slides and resizes from the content box at gesture start", () => {
  const { floater, grip, resize, rect, orbit, outerPointer } = setup();
  pointer(grip, "pointerdown", 400, 10);
  pointer(grip, "pointermove", 400, 90);
  pointer(grip, "pointerup", 400, 90);
  expect(floater.style.translate).toBe("0 80px");

  // Content can arrive after mounting. Its first measured box still obeys the field's caps.
  rect.mockReturnValue(new DOMRect(100, 10, 490, 500));
  pointer(resize, "pointerdown", 100, 510);
  pointer(resize, "pointermove", 90, 520);
  pointer(resize, "pointerup", 90, 520);
  expect([floater.style.width, floater.style.height]).toEqual(["240px", "420px"]);
  expect(floater.style.getPropertyValue("--floater-content-w")).toBe("100%");
  expect(orbit.read()).toEqual(viewport);
  expect(outerPointer).not.toHaveBeenCalled();
});

test("shrinking a navigation field caps its floaters and restores their preferred size on growth", () => {
  const observers: (() => void)[] = [];
  vi.stubGlobal(
    "ResizeObserver",
    class {
      constructor(callback: () => void) {
        observers.push(callback);
      }
      observe() {}
      disconnect() {}
    },
  );
  const { floater } = setup({ width: 230, height: 230 });
  const field = vi.spyOn(floater.parentElement!, "getBoundingClientRect");
  field.mockReturnValue(new DOMRect(0, 0, 280, 500));
  act(() => observers.forEach((run) => run()));
  expect([floater.style.width, floater.style.height]).toEqual(["112px", "112px"]);
  field.mockReturnValue(new DOMRect(0, 0, 600, 600));
  act(() => observers.forEach((run) => run()));
  expect([floater.style.width, floater.style.height]).toEqual(["230px", "230px"]);
});

test("explicit sizes keep responsive caps and resize handles leave globe orbit dragging intact", () => {
  const { view, orbit, onViewport, floater, resize } = setup({ width: 230, height: 230 });
  pointer(resize, "pointerdown", 360, 240);
  pointer(resize, "pointermove", -1000, 1000);
  pointer(resize, "pointerup", -1000, 1000);
  expect([floater.style.width, floater.style.height]).toEqual(["240px", "420px"]);
  expect(onViewport).not.toHaveBeenCalled();
  const globe = view.getByRole("group", { name: "orbit globe" });
  pointer(globe, "pointerdown", 400, 100);
  pointer(globe, "pointermove", 450, 125);
  pointer(globe, "pointerup", 450, 125);
  expect(orbit.read()).toEqual({ ...viewport, yaw: 10, elev: 40 });
  expect(onViewport).toHaveBeenCalledExactlyOnceWith({ ...viewport, yaw: 10, elev: 40 }, "gesture");
});
