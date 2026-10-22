// @vitest-environment jsdom
import { cleanup, fireEvent, render, renderHook } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vite-plus/test";
import { usePivotMap } from "./pivot-map";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

test("the pivot floater centres a thumbnail click through the table's scrollTo", () => {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
  const el = document.createElement("div");
  for (const [key, value] of Object.entries({
    scrollWidth: 4000,
    scrollHeight: 3000,
    clientWidth: 800,
    clientHeight: 600,
  }))
    Object.defineProperty(el, key, { value });
  const scrollTo = vi.fn();
  el.scrollTo = scrollTo;
  const rows: Parameters<typeof usePivotMap>[1] = [];
  const types: Parameters<typeof usePivotMap>[2] = [];
  const overlay = { cells: {}, parameters: {}, unprojected: [] };
  const scroller = { current: el };
  const { result } = renderHook(() => usePivotMap(scroller, rows, types, overlay));
  const view = render(result.current.render());
  fireEvent.click(view.container.querySelector("canvas")!, { clientX: 130, clientY: 97.5 });
  expect(scrollTo).toHaveBeenCalledWith({ top: 1200, left: 1600 });
  expect(result.current.chord).toBe("M");
});
