// @vitest-environment jsdom
import { afterEach, expect, test } from "vite-plus/test";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { TooltipHint, TooltipProvider } from "../src/components/lang/tooltip";

afterEach(cleanup);

const move = (dx: number) => {
  const event = new MouseEvent("pointermove", { bubbles: true });
  Object.defineProperties(event, { movementX: { value: dx }, movementY: { value: 0 } });
  window.dispatchEvent(event);
};

// A list that shrinks after a pick slides a hinted chip under a pointer that never moved.
test("after a press, a hint waits for the pointer to move", async () => {
  render(
    <TooltipProvider delay={0}>
      <TooltipHint content="Clear this filter">
        <button type="button">Needs review</button>
      </TooltipHint>
    </TooltipProvider>,
  );
  const chip = screen.getByRole("button", { name: "Needs review" });
  fireEvent.pointerDown(document.body);
  move(0); // a layout-only mousemove carries no movement
  fireEvent.mouseEnter(chip);
  await new Promise((resolve) => setTimeout(resolve, 50));
  expect(screen.queryByRole("tooltip")).toBeNull();

  move(3);
  fireEvent.mouseLeave(chip);
  fireEvent.mouseEnter(chip);
  expect((await screen.findByRole("tooltip")).textContent).toBe("Clear this filter");
});
