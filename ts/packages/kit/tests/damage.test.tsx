// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { cleanup, render } from "@testing-library/react";
import { afterEach, expect, test } from "vite-plus/test";
import { Row } from "../src/components/lang/row";
import { Minimap } from "../src/components/lang/gutter-minimap";

afterEach(cleanup);
const css = readFileSync(createRequire(import.meta.url).resolve("@pe/kit/lang/lang.css"), "utf8");
test.each([200, 1000])(
  "%i damaged minimap marks share one static layer and leave healthy heads static",
  (count) => {
    const scroller = document.createElement("div");
    const props = { count, range: { start: 0, end: 10 }, scroller, height: 200, onJump() {} };
    const marks = Array.from({ length: count }, (_, index) => ({ index, damage: "unpreviewed" }));
    const view = render(<Minimap {...props} marks={[...marks, { index: count, head: true }]} />);
    const surface = scroller.querySelector("[data-damage-surface]")!;
    expect(scroller.querySelectorAll("[data-damage-surface]")).toHaveLength(1);
    expect(surface.querySelectorAll("[data-damage]")).toHaveLength(count);
    expect(scroller.querySelectorAll('[data-minimap="rows"] > i')).toHaveLength(1);
    expect(surface.querySelector("[data-minimap-viewport]")).toBeNull();
    view.rerender(<Minimap {...props} marks={[{ index: 0, head: true }]} />);
    expect(scroller.querySelector("[data-damage-surface]")).toBeNull();
  },
);
test("damage stays static at rest, with the same alarm mark for either motion preference", () => {
  expect(document.documentElement.style.getPropertyValue("--pe-alarm")).toBe("#b3140a");
  expect(css).not.toMatch(/@keyframes\s+pe-damage-beat|animation:\s*pe-damage-beat/);
  expect(css).toContain("box-shadow: inset 0 0 3px var(--pe-alarm)");
  expect(css).toContain("outline: 1px solid var(--pe-alarm)");
  expect(css).toContain("stroke: var(--pe-alarm)");
});
test("damage is a yielding trailing fact, with a readable title floor", () => {
  const { container } = render(<Row label="Heat pump" damage="unpreviewed" meta="123.4" />);
  expect(container.querySelector(".dl-row-meta .dl-row-damage")?.textContent).toBe("unpreviewed");
  expect(css).toContain("minmax(min(12ch, 100%), 1fr)");
  expect(css).toMatch(/@container list \(max-width: 240px\)\s*\{\s*\.dl-row-damage/);
});
