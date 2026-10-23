// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, test } from "vite-plus/test";
import { TooltipHint } from "../src/components/lang/tooltip";

afterEach(cleanup);

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
