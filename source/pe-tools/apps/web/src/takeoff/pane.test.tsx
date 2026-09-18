// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vite-plus/test";

const controller = vi.hoisted(() => ({ target: "C:\\Projects\\A.rvt" as string | null }));
vi.mock("#/takeoff/controller", () => ({
  useTakeoffsController: () => ({ handle: { work: { key: { target: controller.target } } } }),
}));
vi.mock("#/takeoff/route-workspace", () => ({ TakeoffsPage: () => null }));
vi.mock("#/takeoff/route", () => ({ TakeoffsControllerOwner: () => null }));
vi.mock("#/route", async (actual) => ({
  ...(await actual<typeof import("#/route")>()),
  RouteShell: () => null,
}));
vi.mock("#/readings", async (actual) => ({
  ...(await actual<typeof import("#/readings")>()),
  // The host's saved list: summaries of every capture, whatever document they read.
  useReading: () => ({
    state: "ready",
    observation: [
      {
        id: "a".repeat(64),
        document: "c:/projects/a.rvt",
        title: "A",
        capturedAt: "2026-09-18T10:00:00Z",
        provenance: { kind: "live", target: { session: "s", openId: "1" } },
      },
      {
        id: "b".repeat(64),
        document: "C:\\Projects\\B.rvt",
        title: "B",
        capturedAt: "2026-09-18T11:00:00Z",
        provenance: { kind: "live", target: { session: "s", openId: "2" } },
      },
    ],
  }),
}));

import { TakeoffsPane } from "./pane";

afterEach(cleanup);

test("the hosted saved review lists only the thread document's captures", () => {
  render(<TakeoffsPane thread="thread-1" />);
  fireEvent.click(screen.getByRole("button", { name: "saved review" }));
  // Same document by Address rules (case and separators), the other document absent.
  expect(screen.getByRole("button", { name: /^A · / })).toBeTruthy();
  expect(screen.queryByRole("button", { name: /^B · / })).toBeNull();
});

test("a thread with no resolved document lists no captures", () => {
  controller.target = null;
  render(<TakeoffsPane thread="thread-1" />);
  fireEvent.click(screen.getByRole("button", { name: "saved review" }));
  expect(screen.queryByRole("button", { name: / · 2026/ })).toBeNull();
});
