// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vite-plus/test";
import { TooltipProvider } from "../src/components/lang/tooltip";

import { Button, ButtonOutcome } from "../src/components/lang/button";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

test.each([600, 300])(
  "outcomes clear the enclosing form at y=%i in a 384 by 700 viewport",
  async (top) => {
    vi.spyOn(document.documentElement, "clientWidth", "get").mockReturnValue(384);
    vi.spyOn(document.documentElement, "clientHeight", "get").mockReturnValue(700);
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
      function (this: HTMLElement) {
        if (this.tagName === "HTML") return new DOMRect(0, 0, 384, 700);
        if (this.tagName === "FORM") return new DOMRect(16, top, 352, 92);
        if (this.tagName === "BUTTON") return new DOMRect(340, top + 56, 24, 24);
        return new DOMRect(0, 0, 220, 36);
      },
    );
    vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockReturnValue(220);
    vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockReturnValue(36);
    render(
      <form>
        <textarea />
        <ButtonOutcome value={{ kind: "refused", label: "cannot attach" }}>
          <Button label="attach" />
        </ButtonOutcome>
      </form>,
    );
    const alert = await screen.findByRole("alert");
    const popup = alert.closest<HTMLElement>('[data-slot="popover-content"]')!;
    const positioner = popup.parentElement!;
    await waitFor(() => {
      expect(popup.getAttribute("data-side")).toBe(top === 600 ? "top" : "bottom");
      const [x, y] = positioner.style.transform.match(/-?\d+(?:\.\d+)?/g)!.map(Number);
      expect(x).toBeGreaterThanOrEqual(8);
      expect(x + 220).toBeLessThanOrEqual(376);
      expect(top === 600 ? y + 36 <= top - 6 : y >= top + 92 + 6).toBe(true);
    });
  },
);

test("a refused Button exposes its explanation on focus without a native title", async () => {
  const click = vi.fn();
  render(
    <TooltipProvider delay={0}>
      <Button label="Apply" refusal="Document is closed" onClick={click}>
        Apply
      </Button>
    </TooltipProvider>,
  );
  const button = screen.getByRole("button", { name: "Apply" });
  expect(button.hasAttribute("title")).toBe(false);
  fireEvent.keyDown(document.body, { key: "Tab" });
  await act(async () => button.focus());
  expect(await screen.findByRole("tooltip")).toBeTruthy();
  expect(screen.getByText("Document is closed")).toBeTruthy();
  fireEvent.click(button);
  expect(click).not.toHaveBeenCalled();
});
