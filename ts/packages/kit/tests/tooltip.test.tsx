// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vite-plus/test";
import { SvgTip, TooltipHint, TooltipProvider } from "../src/components/lang/tooltip";
import { SubjectBox } from "../src/components/lang/popover-internal";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

test("closed hints do not measure the picture; opening reads the current subject box", async () => {
  vi.useFakeTimers();
  const box = vi.fn(() => new DOMRect(10, 20, 100, 100));
  render(
    <SubjectBox box={box}>
      <TooltipProvider delay={0}>
        <TooltipHint content="Current evidence">
          <button>Hint</button>
        </TooltipHint>
      </TooltipProvider>
    </SubjectBox>,
  );
  expect(box).not.toHaveBeenCalled();
  fireEvent.focus(screen.getByRole("button", { name: "Hint" }));
  await act(() => vi.advanceTimersByTime(10));
  expect(box).toHaveBeenCalled();
  expect(screen.getByRole("tooltip").textContent).toBe("Current evidence");
});

function evidence(svg = false) {
  const go = vi.fn();
  const content = (
    <>
      <span>Evidence</span>
      {[1, 2, 3].map((n) => (
        <TooltipHint key={n} side="right" content={`Subject ${n}: go to it`}>
          <a href={`#subject-${n}`} onClick={() => go(n)}>
            Subject {n}
          </a>
        </TooltipHint>
      ))}
    </>
  );
  const view = render(
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
      <TooltipHint content={undefined}>
        <button>yes</button>
      </TooltipHint>
      <TooltipHint content="no: the claim is wrong">
        <button>no</button>
      </TooltipHint>
      {svg && (
        <svg>
          <circle aria-label="round mark" aria-description="original">
            <SvgTip content="round" />
          </circle>
        </svg>
      )}
    </TooltipProvider>,
  );
  const trigger = svg ? screen.getByTestId("mark") : screen.getByLabelText("What is this?");
  return { go, unmount: view.unmount, trigger };
}

async function hover(trigger: Element, x: number, y: number, ms = 400) {
  fireEvent.pointerEnter(trigger, { pointerType: "mouse", clientX: x, clientY: y });
  fireEvent.mouseEnter(trigger, { clientX: x, clientY: y });
  fireEvent.mouseMove(trigger, { clientX: x, clientY: y });
  await act(() => vi.advanceTimersByTime(ms));
}

test.each(
  [
    { place: "above", box: new DOMRect(926, 142, 384, 50) },
    { place: "below", box: new DOMRect(926, 224, 384, 50) },
    { place: "left", box: new DOMRect(516, 190, 384, 50) },
    { place: "right", box: new DOMRect(972, 190, 384, 50) },
    { place: "reported", box: new DOMRect(952, 198, 384, 50) },
  ].flatMap((place) =>
    [false, true].flatMap((svg) => [1, 2, 3].map((n) => ({ ...place, svg, n }))),
  ),
)(
  "$place reference $n stays reachable through nested hints (SVG=$svg)",
  async ({ box, svg, n }) => {
    vi.useFakeTimers();
    const anchorBox = new DOMRect(926, 198, 20, 20);
    vi.spyOn(document.documentElement, "clientWidth", "get").mockReturnValue(1440);
    vi.spyOn(document.documentElement, "clientHeight", "get").mockReturnValue(900);
    vi.spyOn(SVGElement.prototype, "getBoundingClientRect").mockReturnValue(anchorBox);
    const measure = function (this: HTMLElement) {
      const number = Number(this.textContent?.at(-1));
      if (this.matches("a"))
        return new DOMRect(box.left - 12.484375 + number * 70, box.top + 25, 63.71875, 20);
      const popup = this.getAttribute("role") === "tooltip" ? this : this.firstElementChild;
      if (popup?.getAttribute("role") === "tooltip") {
        if (popup.textContent?.startsWith("Evidence")) return box;
        const transform = popup.parentElement!.style.transform;
        const xy = transform.match(/translate\(([-\d.]+)px, ([-\d.]+)px\)/);
        return new DOMRect(Number(xy?.[1]) || 0, Number(xy?.[2]) || 0, 167.7265625, 30.5);
      }
      return this.tagName === "BUTTON" ? anchorBox : new DOMRect();
    };
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(measure);
    for (const property of ["offsetWidth", "offsetHeight"] as const)
      vi.spyOn(HTMLElement.prototype, property, "get").mockImplementation(
        function (this: HTMLElement) {
          return measure.call(this)[property === "offsetWidth" ? "width" : "height"];
        },
      );
    const { trigger, go } = evidence(svg);
    await hover(trigger, 936, 208);
    const popup = screen.getByText("Evidence").closest('[role="tooltip"]')!;
    const refs = screen.getAllByRole("link"),
      ref = refs[n - 1]!;
    const end = ref.getBoundingClientRect();
    const inside = (element: Element, x: number, y: number) => {
      const r = element.getBoundingClientRect();
      return x >= r.left && x < r.right && y >= r.top && y < r.bottom;
    };
    fireEvent.pointerLeave(trigger);
    fireEvent.mouseLeave(trigger, { clientX: 936, clientY: 208 });
    let hit: Element = trigger;
    for (let step = 1; step <= 6; step++) {
      const clientX = 936 + ((end.x + end.width / 2 - 936) * step) / 6;
      const clientY = 208 + ((end.y + end.height / 2 - 208) * step) / 6;
      const top = screen
        .getAllByRole("tooltip")
        .reverse()
        .find((el) => inside(el, clientX, clientY));
      hit =
        refs.find((el) => top?.contains(el) && inside(el, clientX, clientY)) ??
        top ??
        screen.getByRole("button", { name: "no" });
      fireEvent.mouseEnter(hit, { clientX, clientY });
      fireEvent.mouseMove(hit, { clientX, clientY });
      if (inside(popup, clientX, clientY)) fireEvent.pointerEnter(popup, { pointerType: "mouse" });
      await act(() => vi.advanceTimersByTime(220 / 6));
    }
    for (const hint of screen.getAllByText(/Subject \d: go to it/)) {
      const r = hint.getBoundingClientRect();
      for (const sibling of refs) {
        const s = sibling.getBoundingClientRect();
        const clear =
          r.right <= s.left || r.left >= s.right || r.bottom <= s.top || r.top >= s.bottom;
        expect.soft(clear).toBe(true);
      }
    }
    expect.soft(hit).toBe(ref);
    // A portal leave is not a geometric departure from the parent.
    const contactHint = screen.getAllByText(/Subject \d: go to it/).at(-1)!;
    const point = { clientX: end.x + 32, clientY: end.y + 10 };
    fireEvent.mouseLeave(popup, { ...point, relatedTarget: contactHint });
    fireEvent.mouseMove(contactHint, point);
    fireEvent.mouseLeave(ref, point);
    await act(() => vi.advanceTimersByTime(1100));
    expect(screen.getByText("Evidence").closest('[role="tooltip"]')).toBe(popup);
    expect(screen.getByRole("link", { name: `Subject ${n}` })).toBe(ref);
    expect(ref.getAttribute("aria-description")).toBe(`Subject ${n}: go to it`);
    fireEvent.click(ref);
    expect(go).toHaveBeenCalledWith(n);
    fireEvent.pointerLeave(popup);
    await hover(screen.getByRole("button", { name: "no" }), 900, 250, 701);
    expect(screen.queryByText("Evidence")).toBeNull();
    expect(screen.getByText("no: the claim is wrong")).toBeTruthy();
  },
);

test.each([false, true])(
  "keyboard enters Evidence, returns, exits and Escapes (SVG=%s)",
  async (svg) => {
    vi.useFakeTimers();
    const { trigger, unmount } = evidence(svg);
    await act(async () => trigger.focus());
    const links = screen.getAllByRole("link");
    const tabTo = (next: Element, shiftKey = false) => {
      fireEvent.keyDown(document.activeElement!, { key: "Tab", shiftKey });
      expect(document.activeElement).toBe(next);
    };
    links.forEach((link) => tabTo(link));
    [...links.slice(0, -1).reverse(), trigger].forEach((next) => tabTo(next, true));
    [...links, screen.getByRole("button", { name: "yes" })].forEach((next) => tabTo(next));
    expect(screen.queryByText("Evidence")).toBeNull();
    await act(async () => trigger.focus());
    fireEvent.keyDown(trigger, { key: "Tab" });
    fireEvent.keyDown(screen.getByRole("link", { name: "Subject 1" }), { key: "Escape" });
    await act(() => vi.advanceTimersByTime(701));
    expect(document.activeElement).toBe(trigger);
    expect(screen.queryByText("Evidence")).toBeNull();
    if (svg) {
      vi.useRealTimers();
      const mark = screen.getByLabelText("round mark");
      expect(mark.getAttribute("tabindex")).toBe("0");
      await act(async () => mark.dispatchEvent(new FocusEvent("focus")));
      expect(await screen.findByText("round")).toBeTruthy();
      expect(mark.getAttribute("aria-description")).toBe("round");
      expect(document.querySelector("svg title")).toBeNull();
      unmount();
      expect(mark.getAttribute("aria-description")).toBe("original");
    }
  },
);
