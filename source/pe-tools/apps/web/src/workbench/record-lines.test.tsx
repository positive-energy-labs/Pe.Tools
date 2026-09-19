// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vite-plus/test";

const env = vi.hoisted(() => ({
  setPlugin: vi.fn(),
  rows: [] as { id: string; key: string; state: string }[],
}));
vi.mock("./provider", () => ({
  useWorkbench: () => ({ store: { actions: { setPlugin: env.setPlugin } } }),
}));
vi.mock("#/readings", async (actual) => ({
  ...(await actual<typeof import("#/readings")>()),
  useReading: () => ({ state: "ready", observation: env.rows }),
}));
vi.mock("@tanstack/react-router", () => ({
  Link: ({ children, search }: { children: unknown; search: { actionId: string } }) => (
    <a href={`/ops?actionId=${search.actionId}`}>{children as never}</a>
  ),
}));

import { ActionLine } from "./record-lines";

afterEach(() => {
  cleanup();
  env.setPlugin.mockClear();
});

test("the action line shows the receipt's current state; only succeeded reads as done", () => {
  for (const state of ["running", "succeeded", "failed", "unknown", "cancelled"]) {
    env.rows = [{ id: "run-1", key: "takeoffs.sync", state }];
    const { unmount } = render(<ActionLine call={{ id: "run-1", key: "takeoffs.sync" }} />);
    const word = screen.getByText(state);
    expect(word.closest("div")?.textContent).toContain(`Pea ran sync in Takeoffs · ${state}`);
    expect(word.getAttribute("data-tone")).toBe(
      state === "succeeded" ? "done" : state === "running" ? null : "caution",
    );
    expect(screen.queryByRole("button", { name: /accept|deny|recover|resume|stop/ })).toBeNull();
    unmount();
  }
});

test("open › hosts the receipt's owning route, even from a control call", () => {
  env.rows = [{ id: "run-1", key: "schedule.grid.push", state: "unknown" }];
  render(<ActionLine call={{ id: "run-1", key: "action.resume" }} />);
  expect(screen.getByText(/Pea ran grid push in Schedule Grid/)).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "open ›" }));
  expect(env.setPlugin).toHaveBeenCalledWith("schedules");
});

test("an action no plugin route owns keeps its receipt link", () => {
  env.rows = [{ id: "op-9", key: "revit.context.summary", state: "succeeded" }];
  render(<ActionLine call={{ id: "op-9", key: "revit.context.summary" }} />);
  expect(screen.getByRole("link", { name: "receipt ›" }).getAttribute("href")).toBe(
    "/ops?actionId=op-9",
  );
  expect(screen.queryByRole("button", { name: "open ›" })).toBeNull();
});
