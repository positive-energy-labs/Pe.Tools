// @vitest-environment jsdom
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vite-plus/test";

import { createLiveOrbit } from "#/scene/live-orbit";
import { Floater, type FloaterSpec } from "@pe/kit/lang/floater";
import { OrbitMinimap, type OrbitViewport } from "./minimap";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

test.each([false, true])(
  "floaters avoid earlier siblings even at a free home (legend=%s)",
  (legend) => {
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
      function (this: HTMLElement) {
        if (this.dataset.field !== undefined) return new DOMRect(0, 0, 600, 600);
        if (this.dataset.slot === "pane-legend") return new DOMRect(260, 0, 80, 30);
        if (this.dataset.slot === "floater") {
          const corner = this.dataset.place!;
          const dy = Number(this.style.translate.split(" ")[1]?.replace("px", "")) || 0;
          return new DOMRect(
            corner[1] === "r" ? 500 : 0,
            (corner[0] === "b" ? 500 : 0) + dy,
            100,
            100,
          );
        }
        return new DOMRect();
      },
    );
    const spec = (key: string): FloaterSpec => ({
      key,
      label: key,
      place: "tr",
      size: { width: 100, height: 100 },
      open: true,
      onOpenChange: vi.fn(),
      render: () => key,
    });
    const view = render(
      <div data-field="">
        {legend && <div data-slot="pane-legend" />}
        <Floater spec={spec("first")} />
        <Floater spec={spec("second")} />
      </div>,
    );
    const first = view.getByRole("region", { name: "first" }).getBoundingClientRect();
    const second = view.getByRole("region", { name: "second" }).getBoundingClientRect();
    expect(first.x).toBe(500);
    expect(
      second.bottom <= first.top || second.top >= first.bottom || second.right <= first.left,
    ).toBe(true);
  },
);

test("a floater avoids the docked readout without a legend", () => {
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
    function (this: HTMLElement) {
      if (this.dataset.field !== undefined) return new DOMRect(0, 0, 600, 600);
      if (this.dataset.slot === "pane-dock") return new DOMRect(450, 0, 150, 100);
      if (this.dataset.slot === "floater") return new DOMRect(500, 0, 100, 100);
      return new DOMRect();
    },
  );
  const view = render(
    <div data-field="">
      <div data-slot="pane-dock" />
      <Floater
        spec={{
          key: "dock",
          label: "dock",
          place: "tr",
          size: { width: 100, height: 100 },
          open: true,
          onOpenChange: vi.fn(),
          render: () => "map",
        }}
      />
    </div>,
  );
  const floater = view.getByRole("region", { name: "dock" });
  expect(floater.dataset.place === "tr" && !floater.style.translate).toBe(false);
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
