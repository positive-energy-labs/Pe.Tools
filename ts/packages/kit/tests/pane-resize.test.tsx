// @vitest-environment jsdom
import { Profiler, useState } from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vite-plus/test";

import { PaneSplit } from "@pe/kit/lang/pane-resize";
import { Pane } from "@pe/kit/lang/pane";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function measure(width: number, height = 600) {
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(
    new DOMRect(0, 0, width, height),
  );
  const style = CSSStyleDeclaration.prototype;
  const get = style.getPropertyValue;
  vi.spyOn(style, "getPropertyValue").mockImplementation(
    function (this: CSSStyleDeclaration, name) {
      return name === "--gutter" ? "8px" : get.call(this, name);
    },
  );
}

test.each(["horizontal", "vertical"] as const)(
  "fitting %s reserves the subject minimum and measures all grips before paint",
  (axis) => {
    measure(axis === "horizontal" ? 900 : 600, axis === "horizontal" ? 600 : 900);
    const { container } = render(
      <PaneSplit
        axis={axis}
        start="subject"
        end="drawing"
        resize={{ target: "end", defaultSize: 500, minSize: 260, minOtherSize: 560 }}
      />,
    );
    const split = container.firstElementChild as HTMLElement;
    expect(split.style[axis === "horizontal" ? "gridTemplateColumns" : "gridTemplateRows"]).toBe(
      "minmax(0, 1fr) var(--gutter) var(--pane-size)",
    );
    const style = getComputedStyle(split);
    const size = parseFloat(style.getPropertyValue("--pane-size"));
    expect(size).toBe(332);
    expect(
      split.getBoundingClientRect()[axis === "horizontal" ? "width" : "height"] -
        parseFloat(style.getPropertyValue("--gutter")) -
        size,
    ).toBe(560);
    const seam = screen.getByRole("separator");
    const handles = [...seam.querySelectorAll<HTMLElement>("[data-slot='pane-resize-grip']")];
    expect(handles.map((el) => el.dataset.corner)).toEqual(["center", "tr", "bl"]);
    expect(handles[0]!.style[axis === "horizontal" ? "top" : "left"]).toBe("300px");
    expect(handles.every((el) => el.parentElement === seam)).toBe(true);
    const capture = vi.fn();
    seam.setPointerCapture = capture;
    seam.releasePointerCapture = vi.fn();
    seam.hasPointerCapture = () => true;
    for (const handle of handles) {
      fireEvent.pointerDown(handle, { clientX: 0 });
      fireEvent.pointerUp(handle, { clientX: 0 });
    }
    expect(capture).toHaveBeenCalledTimes(3);
  },
);

test("a split that cannot fit both minimum widths stacks its mounted panes", () => {
  measure(600);
  const { container } = render(
    <PaneSplit
      axis="horizontal"
      start={<input aria-label="filter" defaultValue="kept" />}
      end="drawing"
      resize={{ target: "end", defaultSize: 340, minSize: 260, minOtherSize: 560 }}
    />,
  );
  expect(container.firstElementChild?.getAttribute("data-axis")).toBe("vertical");
  expect((container.firstElementChild as HTMLElement).style.gridTemplateRows).toBe(
    "minmax(0, 1fr) var(--gutter) minmax(0, 1fr)",
  );
  expect(screen.getByRole("textbox", { name: "filter" }).getAttribute("value")).toBe("kept");
  expect(screen.getByText("drawing")).toBeTruthy();
  expect(screen.queryByRole("separator")).toBeNull();
});

test("a lower-priority pane with a collapse affordance yields to its subject", () => {
  measure(600);
  function Dock() {
    const [collapsed, onCollapsedChange] = useState(false);
    return (
      <PaneSplit
        axis="horizontal"
        start="subject"
        end={<input aria-label="draft" defaultValue="kept" />}
        resize={{
          target: "end",
          defaultSize: 300,
          minSize: 300,
          minOtherSize: 400,
          collapse: { collapsed, onCollapsedChange, collapsedSize: 32, title: "thread" },
        }}
      />
    );
  }
  render(<Dock />);
  const input = screen.getByRole("textbox", { name: "draft", hidden: true });
  expect(input.closest(".hidden")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Expand thread" }));
  expect(screen.getByRole("textbox", { name: "draft" })).toBe(input);
  expect(input.getAttribute("value")).toBe("kept");
});

test("a stacked split returns to columns on resize without remounting its contents", () => {
  measure(600);
  let resized: (entries: { contentRect: { width: number; height: number } }[]) => void;
  vi.stubGlobal(
    "ResizeObserver",
    class {
      constructor(private callback: typeof resized) {}
      observe(element: HTMLElement) {
        if (element.getAttribute("data-slot") === "pane-split") resized = this.callback;
      }
      disconnect() {}
      unobserve() {}
    },
  );
  const { container } = render(
    <PaneSplit
      axis="horizontal"
      start={<input aria-label="filter" defaultValue="kept" />}
      end="drawing"
      resize={{ target: "end", defaultSize: 340, minSize: 260, minOtherSize: 560 }}
    />,
  );
  const filter = screen.getByRole("textbox", { name: "filter" });
  expect(container.firstElementChild?.getAttribute("data-axis")).toBe("vertical");
  act(() => resized([{ contentRect: { width: 1200, height: 600 } }]));
  expect(container.firstElementChild?.getAttribute("data-axis")).toBe("horizontal");
  expect(screen.getByRole("textbox", { name: "filter" })).toBe(filter);
  expect(screen.getByRole("separator")).toBeTruthy();
});

test("20 drag steps preview geometry without React commits, then commit once without remounting", () => {
  measure(900);
  vi.stubGlobal("PointerEvent", MouseEvent);
  const storage = { getItem: () => null, setItem: vi.fn() };
  vi.stubGlobal("localStorage", storage);
  HTMLElement.prototype.setPointerCapture = vi.fn();
  HTMLElement.prototype.hasPointerCapture = () => false;
  const commits = vi.fn();
  const pictureCommits = vi.fn();
  const { container } = render(
    <Profiler id="split" onRender={commits}>
      <PaneSplit
        axis="horizontal"
        start={
          <Profiler id="picture" onRender={pictureCommits}>
            <Pane picture legend={null}>
              <canvas />
            </Pane>
          </Profiler>
        }
        end="chat"
        resize={{
          target: "end",
          defaultSize: 500,
          minSize: 260,
          minOtherSize: 560,
          persist: "stillness",
        }}
      />
    </Profiler>,
  );
  const canvas = container.querySelector("canvas");
  const split = container.querySelector<HTMLElement>('[data-slot="pane-split"]')!;
  const handle = screen.getByRole("separator");
  const fitted = split.style.gridTemplateColumns;
  expect(pictureCommits.mock.calls.length).toBeGreaterThan(0);
  fireEvent.pointerDown(handle, { clientX: 600 });
  commits.mockClear();
  pictureCommits.mockClear();
  for (let step = 1; step <= 20; step++) fireEvent.pointerMove(handle, { clientX: 600 + step });
  const during = commits.mock.calls.length;
  expect(split.style.getPropertyValue("--pane-size")).toBe("312px");
  fireEvent.pointerUp(handle);
  expect(during).toBe(0);
  expect(commits).toHaveBeenCalledTimes(1);
  expect(pictureCommits).not.toHaveBeenCalled();
  expect(fitted).toBe("minmax(0, 1fr) var(--gutter) var(--pane-size)");
  expect(container.querySelector("canvas")).toBe(canvas);
  expect(split.style.gridTemplateColumns).toBe("minmax(0, 1fr) var(--gutter) var(--pane-size)");
  expect(getComputedStyle(split).getPropertyValue("--pane-size")).toBe("312px");
  expect(storage.setItem).toHaveBeenCalledExactlyOnceWith("stillness", "312");
});

test.each([true, false])(
  "a narrow split yields with rail=%s, then restores its mounted contents",
  (rail) => {
    measure(600);
    let resized: (entries: { contentRect: DOMRect }[]) => void;
    vi.stubGlobal(
      "ResizeObserver",
      class {
        constructor(private callback: typeof resized) {}
        observe(element: HTMLElement) {
          if (element.getAttribute("data-slot") === "pane-split") resized = this.callback;
        }
        disconnect() {}
        unobserve() {}
      },
    );
    function Dock() {
      const [collapsed, onCollapsedChange] = useState(false);
      return (
        <PaneSplit
          axis="horizontal"
          start="subject"
          end={<input aria-label="draft" defaultValue="kept" />}
          resize={{
            target: "end",
            defaultSize: 300,
            minSize: 300,
            minOtherSize: 400,
            collapse: rail
              ? { collapsed, onCollapsedChange, collapsedSize: 32, title: "thread" }
              : undefined,
          }}
        />
      );
    }
    const { container } = render(<Dock />);
    const input = screen.getByRole("textbox", { name: "draft", hidden: true });
    const split = container.firstElementChild as HTMLElement;
    if (rail) {
      expect(input.closest(".hidden")).toBeTruthy();
      fireEvent.click(screen.getByRole("button", { name: "Expand thread" }));
    } else {
      expect(split.dataset.axis).toBe("vertical");
      expect(split.style.gridTemplateRows).toBe("minmax(0, 1fr) var(--gutter) minmax(0, 1fr)");
      expect(screen.queryByRole("separator")).toBeNull();
    }
    act(() => resized([{ contentRect: new DOMRect(0, 0, 1200, 600) }]));
    expect(split.dataset.axis).toBe("horizontal");
    expect(screen.getByRole("textbox", { name: "draft" })).toBe(input);
    expect(input.getAttribute("value")).toBe("kept");
    expect(screen.getByRole("separator")).toBeTruthy();
  },
);
