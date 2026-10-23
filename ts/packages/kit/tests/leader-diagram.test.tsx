// @vitest-environment jsdom
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vite-plus/test";
import { LeaderDiagram } from "../src/components/lang/leader-diagram";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
test("leaders join segment midpoints to composed rows in both facing orientations and remeasure on scroll", () => {
  let offset = 0;
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
    function (this: HTMLElement) {
      const rect = this.classList.contains("dl-leader-track")
        ? { left: 10, top: 10, bottom: 20, width: 100, height: 10 }
        : this.dataset.key
          ? { left: 120, top: 40 + offset, bottom: 60 + offset, width: 100, height: 20 }
          : { left: 0, top: 0, bottom: 100, width: 240, height: 100 };
      return rect as DOMRect;
    },
  );
  const items = [{ key: "duct", at: [0.25, 0.75], dashed: true }];
  const draw = (bottom = false, right = false) => (
    <LeaderDiagram label="loss" items={items} bottom={bottom} right={right}>
      <div data-key="duct">duct 0.400</div>
    </LeaderDiagram>
  );
  const view = render(draw());
  expect(view.container.querySelector("path")?.getAttribute("d")).toBe(
    "M35 20 V50 H110 M85 20 V50 H110",
  );
  expect(view.container.querySelector("path")?.hasAttribute("data-dashed")).toBe(true);
  view.rerender(draw(true, true));
  expect(view.container.querySelector("path")?.getAttribute("d")).toBe(
    "M35 10 V50 H10 M85 10 V50 H10",
  );
  offset = 10;
  fireEvent.scroll(view.container.querySelector("[data-key]")!);
  expect(view.container.querySelector("path")?.getAttribute("d")).toBe(
    "M35 10 V60 H10 M85 10 V60 H10",
  );
});
