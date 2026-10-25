// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { cleanup, render } from "@testing-library/react";
import { afterEach, expect, test } from "vite-plus/test";
import { Row } from "../src/components/lang/row";

afterEach(cleanup);
const css = readFileSync(createRequire(import.meta.url).resolve("@pe/kit/lang/lang.css"), "utf8");
test("damage stays static at rest, with the same alarm mark for either motion preference", () => {
  expect(document.documentElement.style.getPropertyValue("--pe-alarm")).toBe("#b3140a");
  expect(css).not.toMatch(/@keyframes\s+pe-damage-beat|animation:\s*pe-damage-beat/);
  // Damage marks with an edge and a glow, never `outline`: keyboard focus owns outline and must win.
  const mark = css.match(/:root \[data-damage\] \{([^}]*)\}/)![1]!;
  expect(mark).toContain("inset 0 0 0 1px var(--pe-alarm)");
  expect(mark).toContain("inset 0 0 3px var(--pe-alarm)");
  expect(mark.replace(/\/\*[\s\S]*?\*\//g, "")).not.toContain("outline");
  expect(css).toContain("stroke: var(--pe-alarm)");
});
test("damage is a yielding trailing fact, with a readable title floor", () => {
  const { container } = render(<Row label="Heat pump" damage="unpreviewed" meta="123.4" />);
  expect(container.querySelector(".dl-row-meta .dl-row-damage")?.textContent).toBe("unpreviewed");
  expect(css).toContain("minmax(min(12ch, 100%), 1fr)");
  expect(css).toMatch(/@container list \(max-width: 240px\)\s*\{\s*\.dl-row-damage/);
});
