// @vitest-environment jsdom
import { useState } from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vite-plus/test";

import { PaneSplit } from "@pe/kit/lang/pane-resize";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function measure(width: number, height = 600) {
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
    width,
    height,
    top: 0,
    left: 0,
    right: width,
    bottom: height,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  });
  const original = window.getComputedStyle;
  vi.spyOn(window, "getComputedStyle").mockImplementation((element) => {
    const style = original(element);
    return new Proxy(style, {
      get(target, property) {
        if (property === "getPropertyValue")
          return (name: string) => (name === "--gutter" ? "8px" : target.getPropertyValue(name));
        const value = Reflect.get(target, property);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
  });
}

test("fitting the supporting pane reserves the subject minimum and the seam", () => {
  measure(900);
  const { container } = render(
    <PaneSplit
      axis="horizontal"
      start="subject"
      end="drawing"
      resize={{ target: "end", defaultSize: 500, minSize: 260, minOtherSize: 560 }}
    />,
  );
  expect((container.firstElementChild as HTMLElement).style.gridTemplateColumns).toBe(
    "minmax(0, 1fr) var(--gutter) 332px",
  );
});

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
