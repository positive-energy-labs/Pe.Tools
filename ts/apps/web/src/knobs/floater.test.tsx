// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vite-plus/test";
import KnobsFloater from "./floater";
import { defineKnobs, num, resetKnob } from "./knobs";

afterEach(() => {
  cleanup();
  resetKnob();
});

it("finds labelled controls with units, commits captures on release, and resets a group", () => {
  const knobs = defineKnobs("capture-test", "capture.ts", {
    context: { padding: num("Capture padding", 15, [0, 60, 1], "refetch", "ft") },
  });
  render(<KnobsFloater />);
  fireEvent.click(screen.getByRole("button", { name: "knobs" }));
  fireEvent.change(screen.getByRole("searchbox", { name: "Find knob" }), {
    target: { value: "Capture padding" },
  });
  expect(screen.getByText("ft")).toBeTruthy();
  const slider = screen.getByRole("slider", { name: "Capture padding" });
  fireEvent.change(slider, { target: { value: "23" } });
  expect(knobs.read().context.padding).toBe(15);
  fireEvent.pointerUp(slider);
  expect(knobs.read().context.padding).toBe(23);
  const exact = screen.getByRole("spinbutton", { name: "Capture padding value" });
  fireEvent.change(exact, { target: { value: "31" } });
  fireEvent.keyDown(exact, { key: "Enter" });
  expect(knobs.read().context.padding).toBe(31);
  fireEvent.click(screen.getByRole("button", { name: "Reset capture-test.context" }));
  expect(knobs.read().context.padding).toBe(15);
  fireEvent.keyDown(screen.getByRole("region", { name: "Development knobs" }), { key: "Escape" });
  expect(screen.queryByRole("region", { name: "Development knobs" })).toBeNull();
});
