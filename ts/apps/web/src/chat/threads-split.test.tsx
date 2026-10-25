// @vitest-environment jsdom
import { useState } from "react";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vite-plus/test";
import { ThreadsSplit } from "./chat-shell";

vi.mock("#/navigation/surface-host", () => ({ useSurfaceHost: () => ({ surface: "web" }) }));

beforeEach(() => {
  // Comfort tokens, so Pea's floor reads 643px as in the app.
  const root = document.documentElement.style;
  root.setProperty("--gutter", "8px");
  root.setProperty("--type-prose-size", "13px");
  root.setProperty("--control-h", "24px");
  // Pea's surface at 1400x900 with the tools open: 683px (round 7's measured width).
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(
    new DOMRect(0, 0, 683, 800),
  );
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function Dock() {
  const [open, setOpen] = useState(false);
  return (
    <ThreadsSplit
      narrow={false}
      sideOpen={open}
      setSideOpen={setOpen}
      threads={() => (
        <nav aria-label="Threads">
          <div role="option" aria-selected={false}>
            Office model
          </div>
        </nav>
      )}
    >
      <div>transcript</div>
    </ThreadsSplit>
  );
}

test("at 1400x900 with tools open, Expand threads leaves the thread rows visible", () => {
  render(<Dock />);
  // Squeezed: the rail is the affordance, and the inline sidebar stays folded.
  fireEvent.click(screen.getByRole("button", { name: "Expand threads" }));
  // The person's expand wins: the rows are shown (as an overlay), not silently refolded.
  const dialog = screen.getByRole("dialog");
  expect(within(dialog).getByRole("option", { name: "Office model" })).toBeTruthy();
});
