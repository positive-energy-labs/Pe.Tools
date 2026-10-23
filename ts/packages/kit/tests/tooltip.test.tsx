// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vite-plus/test";
import { SvgTip, TooltipHint } from "../src/components/lang/tooltip";

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

test("region help supplies its own accessible trigger", () => {
  render(<TooltipHint>Region explanation</TooltipHint>);
  expect(screen.getByRole("button", { name: "What is this?" })).toBeTruthy();
});

test("SVG tips keep footnote links reachable across the shared travel grace", async () => {
  vi.useFakeTimers();
  const go = vi.fn();
  const view = render(
    <svg>
      <g data-testid="mark">
        <circle r="8" />
        <SvgTip
          content={
            <a href="#subject" onClick={go}>
              Subject one
            </a>
          }
        />
      </g>
    </svg>,
  );
  fireEvent.focus(view.getByTestId("mark"));
  await act(async () => {});
  fireEvent.pointerLeave(view.getByTestId("mark"));
  await act(() => vi.advanceTimersByTime(600));
  const link = view.getByRole("link", { name: "Subject one" });
  fireEvent.pointerEnter(link.closest("[role=tooltip]")!);
  await act(() => vi.advanceTimersByTime(800));
  fireEvent.click(view.getByRole("link", { name: "Subject one" }));
  expect(go).toHaveBeenCalledOnce();
  fireEvent.pointerLeave(link.closest("[role=tooltip]")!);
  await act(() => vi.advanceTimersByTime(701));
  expect(view.queryByRole("tooltip")).toBeNull();
});
