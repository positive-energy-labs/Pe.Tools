// @vitest-environment jsdom
import { useState } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vite-plus/test";
import type { PaneSide } from "@pe/kit/lang/pane";
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
  const [collapsed, onCollapsedChange] = useState<PaneSide | null>(null);
  return (
    <ThreadsSplit
      collapsed={collapsed}
      onCollapsedChange={onCollapsedChange}
      threads={
        <nav aria-label="Threads">
          <div role="option" aria-selected={false} onClick={() => onCollapsedChange(null)}>
            Office model
          </div>
        </nav>
      }
    >
      <input aria-label="draft" defaultValue="kept" />
    </ThreadsSplit>
  );
}

test("under both floors, threads and chat trade one rail while retaining the draft", () => {
  render(<Dock />);
  const draft = screen.getByRole("textbox", { name: "draft" });
  fireEvent.change(draft, { target: { value: "unsent" } });
  fireEvent.click(screen.getByRole("button", { name: "Expand threads" }));
  const office = screen.getByRole("option", { name: "Office model" });
  expect(draft.closest(".hidden")).toBeTruthy();
  expect(screen.queryByRole("dialog")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Expand chat" }));
  expect(screen.getByRole("textbox", { name: "draft" })).toBe(draft);
  expect((draft as HTMLInputElement).value).toBe("unsent");
  expect(office.closest(".hidden")).toBeTruthy();
  expect(screen.queryByRole("option", { name: "Office model" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Expand threads" }));
  fireEvent.click(screen.getByRole("option", { name: "Office model" }));
  expect(draft.closest(".hidden")).toBeNull();
  expect(office.closest(".hidden")).toBeTruthy();
});
