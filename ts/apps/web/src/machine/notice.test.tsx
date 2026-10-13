// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vite-plus/test";

import { MACHINE_SEEDS } from "#/open/seeds";

import { NOTICE_HOLD_MS, NoticeCard } from "./notice";

const permission = vi.fn<(id: string, requestId: string, optionId: string) => Promise<void>>();
vi.mock("#/workbench/provider/harness-client", () => ({
  harnessClient: () => ({ permission }),
}));

const asking = {
  id: "10000000-0000-4000-8000-000000000001",
  revision: 1,
  title: "Pea wants approval · ducts",
  body: "pe_do revit.ducts.resize",
  href: "/pea?thread=t1",
  act: {
    kind: "permission" as const,
    threadId: "t1",
    requestId: "r1",
    options: [
      { optionId: "allow", name: "Allow once", kind: "allow_once" },
      { optionId: "deny", name: "Deny", kind: "reject_once" },
    ],
  },
};

let postMessage: ReturnType<typeof vi.fn<(message: unknown) => void>>;
beforeEach(() => {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  postMessage = vi.fn<(message: unknown) => void>();
  window.chrome = { webview: { postMessage } };
  permission.mockReset();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  delete window.chrome;
});

test("a card holds while hovered, then hides itself and tells the tray", () => {
  vi.useFakeTimers();
  render(<NoticeCard reading={MACHINE_SEEDS["no-revit"]} fixture />);
  act(() =>
    window.peNotice?.({ id: "n", revision: 1, title: "Revit start succeeded", body: "Done." }),
  );
  const card = screen.getByRole("status", { name: "notice" });
  fireEvent.mouseEnter(card);
  act(() => void vi.advanceTimersByTime(NOTICE_HOLD_MS * 3));
  expect(screen.getByText("Revit start succeeded")).toBeTruthy();
  fireEvent.mouseLeave(card);
  act(() => void vi.advanceTimersByTime(NOTICE_HOLD_MS));
  expect(screen.queryByRole("status", { name: "notice" })).toBeNull();
  expect(postMessage).toHaveBeenLastCalledWith({ kind: "hide" });
});

test("the body opens the card's href in the app window", () => {
  render(<NoticeCard reading={MACHINE_SEEDS["no-revit"]} fixture={false} />);
  act(() => window.peNotice?.(asking));
  fireEvent.click(screen.getByRole("button", { name: /Pea wants approval/ }));
  expect(postMessage).toHaveBeenLastCalledWith({ kind: "open", href: "/pea?thread=t1" });
});

test("a permission answer goes to the thread's door; the card closes only when it accepts", async () => {
  permission.mockRejectedValueOnce(Error("no request r1")).mockResolvedValueOnce();
  render(<NoticeCard reading={MACHINE_SEEDS["no-revit"]} fixture={false} />);
  act(() => window.peNotice?.(asking));
  await act(async () => fireEvent.click(screen.getByRole("button", { name: "Allow once" })));
  expect(permission).toHaveBeenCalledWith("t1", "r1", "allow");
  expect(screen.getByText(/Pea did not take this answer: Error: no request r1/)).toBeTruthy();
  expect(postMessage).not.toHaveBeenCalledWith({ kind: "hide" });
  await act(async () => fireEvent.click(screen.getByRole("button", { name: "Allow once" })));
  expect(screen.queryByRole("status", { name: "notice" })).toBeNull();
  expect(postMessage).toHaveBeenLastCalledWith({ kind: "hide" });
});

test("a fixture card refuses to answer for Pea", () => {
  render(<NoticeCard reading={MACHINE_SEEDS["no-revit"]} fixture />);
  act(() => window.peNotice?.(asking));
  fireEvent.click(screen.getByRole("button", { name: "Allow once" }));
  expect(permission).not.toHaveBeenCalled();
});
