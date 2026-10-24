// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, expect, test } from "vite-plus/test";
import { Row } from "../src/components/lang/row";

afterEach(cleanup);
const css = readFileSync(createRequire(import.meta.url).resolve("@pe/kit/lang/lang.css"), "utf8");
test("damage animates only opacity; reduced motion keeps the static mark without promoted layers", () => {
  expect(document.documentElement.style.getPropertyValue("--pe-alarm")).toBe("#b3140a");
  const beat = css.match(/@keyframes pe-damage-beat\s*\{[\s\S]*?\n\}/)![0];
  expect(beat).not.toMatch(/(?:filter|box-shadow|outline)\s*:/);
  expect(beat).toMatch(/opacity\s*:/);
  expect(css).toMatch(
    /@media \(prefers-reduced-motion: reduce\)[\s\S]*?:root \[data-damage\]\s*\{[^}]*animation: none;[^}]*will-change: auto;/,
  );
});
test.each(["div", "span", "rect"])("late %s damage joins one clock", (tag) => {
  const element = document.createElement(tag);
  const beat = { animationName: "pe-damage-beat", startTime: 987 };
  const other = { animationName: "pe-landed", startTime: 654 };
  Object.assign(element, { getAnimations: () => [beat, other] });
  document.body.append(element);
  const event = new Event("animationstart", { bubbles: true });
  fireEvent(element, Object.assign(event, { animationName: "pe-damage-beat" }));
  expect(beat.startTime).toBe(0);
  expect(other.startTime).toBe(654);
  element.remove();
});
test("damage is a yielding trailing fact, with a readable title floor", () => {
  const { container } = render(<Row label="Heat pump" damage="unpreviewed" meta="123.4" />);
  expect(container.querySelector(".dl-row-meta .dl-row-damage")?.textContent).toBe("unpreviewed");
  expect(css).toContain("minmax(min(12ch, 100%), 1fr)");
  expect(css).toMatch(/@container list \(max-width: 240px\)\s*\{\s*\.dl-row-damage/);
});
