// @vitest-environment jsdom
import { useState } from "react";
import { cleanup, render } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vite-plus/test";

import { Connectors } from "#/components/lang/connector";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const rect = (left: number, top: number, width: number, height: number) =>
  ({
    left,
    top,
    width,
    height,
    right: left + width,
    bottom: top + height,
    x: left,
    y: top,
  }) as DOMRect;

/** jsdom lays nothing out: each element answers the rect its `data-rect` names. */
const layOut = () =>
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
    const said = (this as HTMLElement).dataset?.rect;
    if (!said) return rect(0, 0, 0, 0);
    const [l, t, w, h] = said.split(" ").map(Number) as [number, number, number, number];
    return rect(l, t, w, h);
  });

function Bay({ anchorTop }: { anchorTop: number }) {
  const [bay, setBay] = useState<HTMLDivElement | null>(null);
  return (
    <div ref={setBay} data-rect="0 0 400 200" style={{ position: "relative" }}>
      <div data-rect="0 0 200 100" style={{ overflow: "auto" }}>
        <div data-key="jack" data-rect={`0 ${anchorTop} 200 20`} />
        <div data-key="foot" data-rect="0 80 200 20" />
      </div>
      <div data-key="socket" data-rect="300 40 100 20" />
      <Connectors
        container={bay}
        links={[
          { key: "a", from: "jack", to: "socket", tone: "commit", band: 0.5 },
          { key: "b", from: ["gone", "foot"], to: "socket" },
        ]}
      />
    </div>
  );
}

test("a line leaves the anchor's right edge and enters the target's left edge", () => {
  layOut();
  const { container } = render(<Bay anchorTop={40} />);
  const line = container.querySelector(".dl-connector[data-tone=commit] .dl-connector-line")!;
  expect(line.getAttribute("d")).toMatch(/^M200,50 C/);
  expect(line.getAttribute("d")).toMatch(/300,50$/);
  const band = container.querySelector(".dl-connector-band")!;
  expect(band.getAttribute("stroke-dasharray")).toBe("50 100");
  expect(container.querySelectorAll(".dl-connector-end[data-off]")).toHaveLength(0);
});

test("an anchor scrolled out of its scroller clamps to the scroller's edge and draws hollow", () => {
  layOut();
  const { container } = render(<Bay anchorTop={-60} />);
  const line = container.querySelector(".dl-connector[data-tone=commit] .dl-connector-line")!;
  // y clamps to the scroller's top edge (0) plus the 2px inset
  expect(line.getAttribute("d")).toMatch(/^M200,2 C/);
  const ends = container.querySelectorAll(".dl-connector[data-tone=commit] .dl-connector-end");
  expect(ends[0]!.hasAttribute("data-off")).toBe(true);
  expect(ends[1]!.hasAttribute("data-off")).toBe(false);
});

test("a missing anchor falls back to the next name in the list", () => {
  layOut();
  const { container } = render(<Bay anchorTop={40} />);
  const lines = container.querySelectorAll(".dl-connector-line");
  expect(lines).toHaveLength(2);
  expect(lines[1]!.getAttribute("d")).toMatch(/^M200,90 C/);
});
