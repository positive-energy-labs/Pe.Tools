// @vitest-environment jsdom
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vite-plus/test";

import { Floater, type FloaterSpec } from "@pe/kit/lang/floater";

const stored = new Map<string, string>();
beforeEach(() => {
  stored.clear();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => stored.get(key) ?? null,
    setItem: (key: string, value: string) => stored.set(key, value),
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const spec = (key: string, size?: FloaterSpec["size"]): FloaterSpec => ({
  key,
  kind: "picture",
  label: key,
  place: "tr",
  size,
  open: true,
  onOpenChange: vi.fn(),
  render: () => <svg aria-label="globe picture" width="220" height="220" />,
});

function mockField(field = new DOMRect(0, 0, 600, 600)) {
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
    function (this: HTMLElement) {
      if (this.dataset.field !== undefined) return field;
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

test("a picture restores its chosen size after remount", () => {
  stored.set(
    `pe:floater:${location.pathname}::globe`,
    JSON.stringify({ width: 190, height: 140, position: "fixed" }),
  );
  const { floater } = setup();
  expect([floater.style.width, floater.style.height]).toEqual(["190px", "140px"]);
  expect(floater.style.position).toBe("");
});

test("picture grips face inward, clamp to the field and persist only the chosen size", () => {
  const { floater, grip, resize, rect, outerPointer } = setup();
  expect(resize.style.left).toBe("0px");
  expect(resize.style.bottom).toBe("0px");
  pointer(grip, "pointerdown", 400, 10);
  pointer(grip, "pointermove", 400, 90);
  pointer(grip, "pointerup", 400, 90);
  expect(floater.style.translate).toBe("0 80px");

  // Content can arrive after mounting. Its first measured box still obeys the field's caps.
  rect.mockReturnValue(new DOMRect(100, 10, 490, 500));
  pointer(resize, "pointerdown", 100, 510);
  pointer(resize, "pointermove", -1000, 2000);
  expect(stored.size).toBe(0);
  pointer(resize, "pointerup", -1000, 2000);
  expect([floater.style.width, floater.style.height]).toEqual(["600px", "600px"]);
  expect(resize.className).toContain("border-l");
  const saved = [...stored.values()][0];
  expect(JSON.parse(saved!)).toEqual({ width: 600, height: 600 });
  cleanup();
  const restored = setup().floater;
  expect([restored.style.width, restored.style.height]).toEqual(["600px", "600px"]);
  expect(floater.style.getPropertyValue("--floater-content-w")).toBe("100%");
  expect(outerPointer).not.toHaveBeenCalled();
  cleanup();
  const minimum = setup().resize;
  pointer(minimum, "pointerdown", 0, 0);
  pointer(minimum, "pointermove", 2000, -2000);
  pointer(minimum, "pointerup", 2000, -2000);
  expect(JSON.parse([...stored.values()][0]!)).toEqual({ width: 64, height: 40 });
});

test.each([undefined, { width: 230, height: 230 }])(
  "folded furniture portals content and focuses without scrolling (size=%s)",
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
    await waitFor(() => expect(focus.mock.contexts).toContain(popup));
    expect(focus.mock.calls.every(([options]) => options?.preventScroll)).toBe(true);
  },
);

test.each(["tl", "tr", "bl", "br"] as const)(
  "legend has no resize target; %s picture grip faces inward",
  (place) => {
    mockField();
    const view = render(
      <div data-field="">
        <Floater spec={{ ...spec("keys"), kind: "legend" }} />
        <Floater spec={{ ...spec("left"), place }} />
      </div>,
    );
    expect(view.queryByLabelText("resize keys")).toBeNull();
    const grip = view.getByLabelText("resize left");
    expect(grip.style[place[1] === "l" ? "right" : "left"]).toBe("0px");
    expect(grip.style[place[0] === "t" ? "bottom" : "top"]).toBe("0px");
    expect(grip.className).toContain(place[1] === "l" ? "border-r" : "border-l");
  },
);
