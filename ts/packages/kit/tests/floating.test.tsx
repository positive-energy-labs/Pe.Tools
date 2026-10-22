// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vite-plus/test";
import { TooltipProvider } from "../src/components/lang/tooltip";

import { Button } from "../src/components/lang/button";

afterEach(cleanup);

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
