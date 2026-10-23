// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vite-plus/test";
import { SvgTip, TooltipHint, TooltipProvider } from "../src/components/lang/tooltip";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

test("an explicitly empty hint preserves its existing trigger", () => {
  render(
    <TooltipHint content={undefined}>
      <button>Original action</button>
    </TooltipHint>,
  );
  expect(screen.getByRole("button", { name: "Original action" })).toBeTruthy();
  expect(screen.queryByRole("button", { name: "What is this?" })).toBeNull();
});

test.each([false, true])(
  "footnotes survive pointer travel and 950ms inside (SVG=%s)",
  async (svg) => {
    vi.useFakeTimers();
    const go = vi.fn();
    const content = (
      <TooltipHint content="Subject one: go to it">
        <a href="#subject" onClick={go}>
          Subject one
        </a>
      </TooltipHint>
    );
    render(
      <TooltipProvider delay={0}>
        {svg ? (
          <svg>
            <g data-testid="mark">
              <SvgTip content={content} />
            </g>
          </svg>
        ) : (
          <TooltipHint>{content}</TooltipHint>
        )}
      </TooltipProvider>,
    );
    const trigger = svg
      ? screen.getByTestId("mark")
      : screen.getByRole("button", { name: "What is this?" });
    fireEvent.pointerEnter(trigger, { pointerType: "mouse" });
    fireEvent.mouseEnter(trigger);
    fireEvent.mouseMove(trigger, { clientX: 20, clientY: 20 });
    await act(() => vi.advanceTimersByTime(400));
    const popup = screen.getByRole("tooltip");
    const link = screen.getByRole("link", { name: "Subject one" });
    fireEvent.pointerLeave(trigger);
    fireEvent.mouseLeave(trigger, { clientX: 20, clientY: 21 });
    for (let step = 1; step <= 3; step++) {
      fireEvent.mouseMove(document.body, { clientX: 20 + step * 10, clientY: 21 + step * 10 });
      await act(() => vi.advanceTimersByTime(50));
      expect(screen.getByRole("tooltip")).toBe(popup);
    }
    fireEvent.pointerEnter(popup, { pointerType: "mouse" });
    fireEvent.mouseEnter(popup.parentElement!);
    fireEvent.pointerEnter(link, { pointerType: "mouse" });
    fireEvent.mouseEnter(link);
    fireEvent.mouseMove(link, { clientX: 50, clientY: 51 });
    await act(() => vi.advanceTimersByTime(1));
    await act(() => vi.advanceTimersByTime(950));
    expect(screen.getByRole("link", { name: "Subject one" })).toBe(link);
    expect(link.getAttribute("aria-description")).toBe("Subject one: go to it");
    fireEvent.click(link);
    expect(go).toHaveBeenCalledOnce();
    fireEvent.pointerLeave(popup);
    fireEvent.mouseLeave(popup.parentElement!);
    await act(() => vi.advanceTimersByTime(701));
    expect(screen.queryByRole("tooltip")).toBeNull();
  },
);
