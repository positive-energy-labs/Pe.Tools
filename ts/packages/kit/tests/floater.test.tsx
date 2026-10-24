// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vite-plus/test";

import { Floater, type FloaterSpec } from "@pe/kit/lang/floater";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const spec = (key: string, size?: FloaterSpec["size"]): FloaterSpec => ({
  key,
  label: key,
  place: "tr",
  size,
  open: true,
  onOpenChange: vi.fn(),
  render: () => <svg aria-label="globe picture" width="220" height="220" />,
});

function mockField(field = new DOMRect(0, 0, 600, 600)) {
  vi.spyOn(document.documentElement, "clientWidth", "get").mockReturnValue(field.width);
  vi.spyOn(document.documentElement, "clientHeight", "get").mockReturnValue(field.height);
  for (const [property, dimension] of [
    ["offsetWidth", "width"],
    ["offsetHeight", "height"],
    ["clientWidth", "width"],
    ["clientHeight", "height"],
  ] as const)
    vi.spyOn(HTMLElement.prototype, property, "get").mockImplementation(
      function (this: HTMLElement) {
        const size = this.getBoundingClientRect()[dimension];
        return this.hasAttribute("data-floater-popup") && property.startsWith("client")
          ? Math.max(0, size - 2)
          : size;
      },
    );
  vi.spyOn(SVGElement.prototype, "getBoundingClientRect").mockImplementation(
    function (this: SVGElement) {
      const panel = this.closest("[data-floater-popup]")?.getBoundingClientRect();
      return new DOMRect((panel?.x ?? 0) + 1, (panel?.y ?? 0) + 1, 220, 220);
    },
  );
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
    function (this: HTMLElement) {
      if (this.dataset.field !== undefined) return field;
      // Before the popup has a size, its 100% wrapper and capped SVG measure zero.
      if (this.dataset.slot === "floater-content")
        return new DOMRect(
          0,
          0,
          this.style.width === "max-content" ? 220 : 0,
          this.style.height === "max-content" ? 220 : 0,
        );
      if (this.matches("button") && this.closest("[data-slot='floater']"))
        return new DOMRect(field.right - 100, field.bottom - 32, 80, 24);
      if (this.style.position === "fixed" || this.hasAttribute("data-floater-popup")) {
        const panel = this.hasAttribute("data-floater-popup")
          ? this
          : this.querySelector<HTMLElement>("[data-floater-popup]");
        const positioner = panel?.parentElement;
        const xy = positioner?.style.transform.match(/translate\(([-\d.]+)px, ([-\d.]+)px\)/);
        return new DOMRect(
          Number(xy?.[1]) || 0,
          Number(xy?.[2]) || 0,
          parseFloat(panel?.style.width ?? "") || 2,
          parseFloat(panel?.style.height ?? "") || 2,
        );
      }
      if (
        this.matches(
          "[data-picture-readout], [data-slot='pane-work'], [data-slot='pane-legend'], [data-slot='pane-resize-grip']",
        )
      )
        return new DOMRect(450, 0, 150, 100);
      if (this.dataset.slot !== "floater") return new DOMRect();
      const corner = this.dataset.place!;
      const dy = Number(this.style.translate.split(" ")[1]?.replace("px", "")) || 0;
      const width = parseFloat(this.style.width) || 100;
      const height = parseFloat(this.style.height) || 100;
      return new DOMRect(
        corner[1] === "r" ? field.right - width : field.left,
        (corner[0] === "b" ? field.bottom - height : field.top) + dy,
        width,
        height,
      );
    },
  );
}

test.each(["sibling", "pane-legend", "data-picture-readout", "pane-work", "pane-resize-grip"])(
  "floaters yield to arriving %s without losing their preferred home",
  async (kind) => {
    mockField();
    const field = (arrived: boolean) => (
      <div data-field="">
        {arrived &&
          (kind === "sibling" ? (
            <Floater spec={spec("first", { width: 100, height: 100 })} />
          ) : (
            <div {...{ [kind === "data-picture-readout" ? kind : "data-slot"]: kind }} />
          ))}
        <Floater spec={spec("second", { width: 160, height: 120 })} />
      </div>
    );
    const view = render(field(false));
    const second = view.getByRole("region", { name: "second" });
    expect(second.dataset.place === "tr" && !second.style.translate).toBe(true);
    view.rerender(field(true));
    await waitFor(() =>
      expect(second.dataset.place === "tr" && !second.style.translate).toBe(false),
    );
    if (kind !== "sibling") return;
    const first = view.getByRole("region", { name: "first" }).getBoundingClientRect();
    const rect = second.getBoundingClientRect();
    expect(first.x).toBe(500);
    expect(rect.right).toBe(first.right);
    expect(rect.bottom <= first.top || rect.top >= first.bottom || rect.right <= first.left).toBe(
      true,
    );
  },
);

const pointer = (el: Element, type: string, x: number, y: number) =>
  fireEvent(el, new MouseEvent(type, { bubbles: true, button: 0, clientX: x, clientY: y }));

function setup(size?: FloaterSpec["size"], field?: DOMRect) {
  mockField(field);
  const outerPointer = vi.fn();
  const view = render(
    <div
      data-field=""
      onPointerDown={outerPointer}
      onPointerMove={outerPointer}
      onPointerUp={outerPointer}
    >
      <Floater spec={spec("globe", size)} />
    </div>,
  );
  const floater = view.getByRole("region", { name: "globe" });
  const rect = vi.fn(() => new DOMRect(360, 10, 230, 230));
  floater.getBoundingClientRect = rect;
  const grip = view.getByLabelText("move globe");
  const resize = view.getByLabelText("resize globe");
  grip.setPointerCapture = resize.setPointerCapture = vi.fn();
  return { view, outerPointer, floater, rect, grip, resize };
}

test("a floater without size slides and resizes from the content box at gesture start", () => {
  const { floater, grip, resize, rect, outerPointer } = setup();
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

test.each([undefined, { width: 230, height: 230 }])(
  "a CSS-folded floater opens on a fixed content-sized plane (size=%s)",
  async (size) => {
    render(<style>{'[data-slot="floater"] { --floater-folded: 1; }'}</style>);
    const { view, floater } = setup(size, new DOMRect(0, 0, 447, 845));
    expect(floater.hasAttribute("data-folded")).toBe(true);
    expect(view.queryByLabelText("globe picture")).toBeNull();
    const focus = vi.spyOn(HTMLElement.prototype, "focus");
    fireEvent.click(view.getByRole("button", { name: "globe" }));
    const svg = await view.findByLabelText("globe picture");
    const popup = svg.closest<HTMLElement>('[data-slot="popover-content"]')!;
    expect(popup).toBeTruthy();
    expect(popup.parentElement!.style.position).toBe("fixed");
    expect(floater.contains(popup)).toBe(false);
    expect(popup.style.width).toBe(size ? "230px" : "222px");
    expect(popup.style.height).toBe(size ? "230px" : "222px");
    const panel = popup.getBoundingClientRect();
    const content = svg.getBoundingClientRect();
    const field = floater.parentElement!.getBoundingClientRect();
    expect(
      panel.left <= content.left &&
        panel.right >= content.right &&
        panel.top <= content.top &&
        panel.bottom >= content.bottom,
    ).toBe(true);
    expect(
      panel.left >= field.left &&
        panel.right <= field.right &&
        panel.top >= field.top &&
        panel.bottom <= field.bottom,
    ).toBe(true);
    expect(popup.dataset.side).toBe("top");
    await waitFor(() => expect(focus.mock.contexts).toContain(popup));
    expect(focus.mock.calls.every(([options]) => options?.preventScroll)).toBe(true);
  },
);
