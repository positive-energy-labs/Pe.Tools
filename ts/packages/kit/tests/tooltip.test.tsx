// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vite-plus/test";
import { SvgTip, TooltipHint, TooltipProvider } from "../src/components/lang/tooltip";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

function evidence() {
  const go = vi.fn();
  render(
    <TooltipProvider delay={0}>
      <TooltipHint>
        <span>Evidence</span>
        {[1, 2, 3].map((n) => (
          <TooltipHint key={n} content={`Subject ${n}: go to it`}>
            <a href={`#subject-${n}`} onClick={() => go(n)}>
              Subject {n}
            </a>
          </TooltipHint>
        ))}
      </TooltipHint>
      <button>yes</button>
      <TooltipHint content="no: the claim is wrong">
        <button>no</button>
      </TooltipHint>
    </TooltipProvider>,
  );
  return { go, trigger: screen.getByRole("button", { name: "What is this?" }) };
}

async function hover(trigger: Element, x: number, y: number) {
  fireEvent.pointerEnter(trigger, { pointerType: "mouse", clientX: x, clientY: y });
  fireEvent.mouseEnter(trigger, { clientX: x, clientY: y });
  fireEvent.mouseMove(trigger, { clientX: x, clientY: y });
  await act(() => vi.advanceTimersByTime(400));
}

test.each(
  [
    { place: "above", box: [926, 142, 384, 50], y: 177, x: [1085.375, 1155.375] },
    { place: "below", box: [926, 224, 384, 50], y: 259, x: [1085.375, 1155.375] },
    { place: "left", box: [516, 190, 384, 50], y: 225, x: [675.375, 745.375] },
    { place: "right", box: [972, 190, 384, 50], y: 225, x: [1131.375, 1201.375] },
  ].flatMap((placement) => [2, 3].map((n) => ({ ...placement, n }))),
)(
  "$place evidence survives a 150ms diagonal through a sibling hint to footnote $n",
  async ({ n, box, x, y }) => {
    vi.useFakeTimers();
    const { go, trigger } = evidence();
    vi.spyOn(trigger, "getBoundingClientRect").mockReturnValue(new DOMRect(926, 198, 20, 20));
    await hover(trigger, 936, 208);
    const popup = screen.getByText("Evidence").closest('[role="tooltip"]')!;
    // R3: actual rendered box above the trigger, even though TooltipHint requests bottom.
    vi.spyOn(popup, "getBoundingClientRect").mockReturnValue(new DOMRect(...box));
    const link = screen.getByRole("link", { name: `Subject ${n}` });
    const end = { x: x[n - 2]!, y };
    fireEvent.mouseLeave(trigger, { clientX: 936, clientY: 208 });
    const sibling = screen.getByRole("button", { name: "no" });
    for (let step = 1; step <= 3; step++) {
      const point = {
        clientX: 936 + ((end.x - 936) * step) / 3,
        clientY: 208 + ((end.y - 208) * step) / 3,
      };
      fireEvent.mouseEnter(sibling, point);
      fireEvent.mouseMove(sibling, point);
      await act(() => vi.advanceTimersByTime(50));
      expect(screen.getByText("Evidence").closest('[role="tooltip"]')).toBe(popup);
    }
    fireEvent.mouseEnter(popup.parentElement!, { clientX: end.x, clientY: end.y });
    fireEvent.mouseEnter(link, { clientX: end.x, clientY: end.y });
    fireEvent.mouseMove(link, { clientX: end.x, clientY: end.y });
    await act(() => vi.advanceTimersByTime(1));
    await act(() => vi.advanceTimersByTime(950));
    expect(screen.getByRole("link", { name: `Subject ${n}` })).toBe(link);
    expect(screen.getByText(`Subject ${n}: go to it`)).toBeTruthy();
    fireEvent.click(link);
    expect(go).toHaveBeenCalledWith(n);
  },
);

test("a path away from the measured popup permits a sibling hint", async () => {
  vi.useFakeTimers();
  const { trigger } = evidence();
  await hover(trigger, 936, 208);
  const popup = screen.getByText("Evidence").closest('[role="tooltip"]')!;
  vi.spyOn(popup, "getBoundingClientRect").mockReturnValue(new DOMRect(926, 142, 384, 50));
  fireEvent.mouseLeave(trigger, { clientX: 936, clientY: 208 });
  await hover(screen.getByRole("button", { name: "no" }), 900, 250);
  expect(screen.queryByText("Evidence")).toBeNull();
  expect(screen.getByText("no: the claim is wrong")).toBeTruthy();
});

test("Tab visits a hover-opened surface's footnotes before returning to the anchor's page order", async () => {
  vi.useFakeTimers();
  const { trigger } = evidence();
  await hover(trigger, 20, 20);
  const links = screen.getAllByRole("link");
  await act(async () => links[0]!.focus());
  fireEvent.keyDown(links[0]!, { key: "Tab" });
  expect(document.activeElement).toBe(links[1]);
  fireEvent.keyDown(links[1]!, { key: "Tab" });
  expect(document.activeElement).toBe(links[2]);
  fireEvent.keyDown(links[2]!, { key: "Tab", shiftKey: true });
  expect(document.activeElement).toBe(links[1]);
  fireEvent.keyDown(links[1]!, { key: "Tab", shiftKey: true });
  fireEvent.keyDown(links[0]!, { key: "Tab", shiftKey: true });
  expect(document.activeElement).toBe(trigger);
  await act(async () => links[2]!.focus());
  fireEvent.keyDown(links[2]!, { key: "Tab" });
  expect(document.activeElement).toBe(screen.getByRole("button", { name: "yes" }));
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
