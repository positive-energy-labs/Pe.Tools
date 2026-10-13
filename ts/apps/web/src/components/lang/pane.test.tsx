// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vite-plus/test";

import { reportFault } from "#/host/diagnostics";

import { Pane } from "./pane";

vi.mock("#/host/diagnostics", () => ({ reportFault: vi.fn() }));
afterEach(cleanup);

function Broken(): never {
  throw Error("C:\\Users\\someone\\model.rvt could not render");
}

test("a pane's caught fault has one owner and one typed fact; the message stays on screen", () => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  render(
    <Pane id="schedule" title="schedule">
      <Broken />
    </Pane>,
  );
  expect(screen.getByRole("alert").textContent).toContain("schedule failed to load");
  expect(reportFault).toHaveBeenCalledTimes(1);
  expect(vi.mocked(reportFault).mock.calls[0]![0]).toEqual({ code: "pane.failed" });
});
