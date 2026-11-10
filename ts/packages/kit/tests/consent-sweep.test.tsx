// @vitest-environment jsdom
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vite-plus/test";
import { ConsentSweep, type ConsentWindow } from "../src/components/lang/consent-sweep";

afterEach(cleanup);

const run: ConsentWindow = {
  requestId: "ask-1",
  threadId: "t1",
  thread: "Size the risers",
  verb: "Pea writes",
  reject: { optionId: "stop_writes" },
  allow: { optionId: "allow_now" },
};

it("D8: a sweep mounted long before a window opens counts the host's 60 s and empties downward", () => {
  vi.useFakeTimers({ toFake: ["Date", "setInterval", "clearInterval"] });
  try {
    const onReject = vi.fn();
    const ui = render(<ConsentSweep windows={[]} onReject={onReject} shell="topbar" />);
    // Minutes pass with no window open, so no interval ever ran (a throttled tab).
    vi.setSystemTime(Date.now() + 133_000);
    const open = { ...run, deadline: new Date(Date.now() + 60_000).toISOString() };
    ui.rerender(<ConsentSweep windows={[open]} onReject={onReject} shell="topbar" />);
    expect(ui.getByRole("timer").textContent).toBe("60s");
    const fill = () => ui.container.querySelector<HTMLElement>("[data-slot='sweep']")!.style.height;
    expect(fill()).toBe("100%");
    act(() => vi.advanceTimersByTime(30_000));
    expect(ui.getByRole("timer").textContent).toBe("30s");
    expect(fill()).toBe("50%");
    // Resolved: the feed drops the window and the row leaves at once.
    ui.rerender(<ConsentSweep windows={[]} onReject={onReject} shell="topbar" />);
    expect(ui.queryByRole("timer")).toBeNull();
  } finally {
    vi.useRealTimers();
  }
});

it("Reject sends the window; auto-approve off draws no sweep and offers Allow", () => {
  const onReject = vi.fn();
  const onAllow = vi.fn();
  const ui = render(<ConsentSweep windows={[run]} onReject={onReject} onAllow={onAllow} shell="card" />);
  expect(ui.queryByRole("timer")).toBeNull();
  expect(ui.container.querySelector("[data-slot='sweep']")).toBeNull();
  expect(ui.getByText("Auto-approve is off")).toBeTruthy();
  fireEvent.click(ui.getByRole("button", { name: "Reject Pea writes" }));
  expect(onReject).toHaveBeenCalledExactlyOnceWith(run);
  fireEvent.click(ui.getByRole("button", { name: "Allow Pea writes" }));
  expect(onAllow).toHaveBeenCalledExactlyOnceWith(run);
});

it("a window with no reject option says why instead of answering", () => {
  const onReject = vi.fn();
  const ui = render(<ConsentSweep windows={[{ ...run, reject: null }]} onReject={onReject} shell="topbar" />);
  fireEvent.click(ui.getByRole("button", { name: "Reject Pea writes" }));
  expect(onReject).not.toHaveBeenCalled();
});
