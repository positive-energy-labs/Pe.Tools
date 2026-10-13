// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vite-plus/test";
import type { MachineNotice } from "@pe/agent-contracts";

import { MACHINE_SEEDS } from "#/open/seeds";

import { NOTICE_DRAIN_MS, NoticeCard } from "./notice";

const permission = vi.fn<(id: string, requestId: string, optionId: string) => Promise<void>>();
const question =
  vi.fn<(id: string, requestId: string, action: string, content?: object) => Promise<void>>();
const prompt = vi.fn<(id: string, input: { text: string }) => Promise<{ turnId: string }>>();
const cancel = vi.fn<(id: string) => Promise<void>>();
vi.mock("#/workbench/provider/harness-client", () => ({
  harnessClient: () => ({ permission, question, prompt, cancel }),
}));

const asking: MachineNotice = {
  id: "10000000-0000-4000-8000-000000000001",
  revision: 1,
  title: "Pea wants approval · ducts",
  body: "pe_do revit.ducts.resize",
  href: "/pea?thread=t1",
  act: {
    kind: "permission",
    threadId: "t1",
    requestId: "r1",
    options: [
      { optionId: "allow", name: "Allow once", kind: "allow_once" },
      { optionId: "deny", name: "Deny", kind: "reject_once" },
    ],
  },
};
const finished: MachineNotice = {
  id: "10000000-0000-4000-8000-000000000002",
  revision: 1,
  title: "Pea finished · ducts",
  body: "Resized **41 of 43** ducts.",
  href: "/pea?thread=t1",
  act: { kind: "reply", threadId: "t1" },
};
const revit: MachineNotice = {
  id: "10000000-0000-4000-8000-000000000003",
  revision: 1,
  title: "Revit start succeeded",
  body: "Done.",
};
const level: MachineNotice = {
  id: "10000000-0000-4000-8000-000000000004",
  revision: 1,
  title: "Pea is asking · ducts",
  body: "Which level?",
  href: "/pea?thread=t1",
  act: {
    kind: "question",
    threadId: "t1",
    requestId: "q1",
    message: "Which level?",
    requestedSchema: { type: "object", properties: { level: { type: "string" } } },
  },
};

let postMessage: ReturnType<typeof vi.fn<(message: string) => void>>;
const sent = (type: string) => postMessage.mock.calls.some(([m]) => JSON.parse(m).type === type);
const show = (...notices: MachineNotice[]) =>
  act(() => notices.forEach((notice) => window.peNotice?.(notice)));
const card = () => screen.queryByRole("status", { name: "notice" });
beforeEach(() => {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  postMessage = vi.fn<(message: string) => void>();
  window.chrome = { webview: { postMessage } };
  for (const door of [permission, question, prompt, cancel]) door.mockReset();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  delete window.chrome;
});

test("the card tells the tray it can take notices only once it listens", () => {
  expect(window.peNotice).toBeUndefined();
  render(<NoticeCard reading={MACHINE_SEEDS["no-revit"]} fixture />);
  expect(window.peNotice).toBeTypeOf("function");
  expect(postMessage).toHaveBeenCalledWith(JSON.stringify({ type: "notice-ready" }));
});

test("one card pages every pending item, and a new notice appends to the open card", () => {
  render(<NoticeCard reading={MACHINE_SEEDS["no-revit"]} fixture />);
  show(revit);
  expect(screen.getByText("1/1")).toBeTruthy();
  show(asking);
  expect(screen.getByText("1/2")).toBeTruthy();
  expect(screen.getByText("Revit start succeeded")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "next" }));
  expect(screen.getByText("2/2")).toBeTruthy();
  expect(screen.getByText("Pea wants approval · ducts")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "previous" }));
  expect(screen.getByText("Revit start succeeded")).toBeTruthy();
  // A later revision of the same receipt replaces its item; it is not a third.
  show({ ...revit, revision: 2, title: "Revit start failed" });
  expect(screen.getByText("1/2")).toBeTruthy();
  expect(screen.getByText("Revit start failed")).toBeTruthy();
});

test("the drain cycles item to item, hover pauses it, and the card dies after the last", () => {
  vi.useFakeTimers();
  render(<NoticeCard reading={MACHINE_SEEDS["no-revit"]} fixture />);
  show(revit, asking);
  act(() => void vi.advanceTimersByTime(NOTICE_DRAIN_MS + 200));
  expect(screen.getByText("2/2")).toBeTruthy();
  fireEvent.mouseEnter(card()!);
  act(() => void vi.advanceTimersByTime(NOTICE_DRAIN_MS * 3));
  expect(screen.getByText("2/2")).toBeTruthy();
  fireEvent.mouseLeave(card()!);
  act(() => void vi.advanceTimersByTime(NOTICE_DRAIN_MS + 200));
  expect(card()).toBeNull();
  expect(postMessage).toHaveBeenLastCalledWith(JSON.stringify({ type: "notice-hide" }));
});

test("typing a reply stops the drain for good; Send takes the prompt door and Stop its slot", async () => {
  vi.useFakeTimers();
  prompt.mockResolvedValue({ turnId: "u2" });
  cancel.mockResolvedValue();
  render(<NoticeCard reading={MACHINE_SEEDS["no-revit"]} fixture={false} />);
  show(finished);
  expect(screen.getByText("41 of 43").tagName).toBe("STRONG");
  fireEvent.change(screen.getByRole("textbox", { name: "reply to Pea" }), {
    target: { value: "number the rest" },
  });
  act(() => void vi.advanceTimersByTime(NOTICE_DRAIN_MS * 5));
  expect(card()).not.toBeNull();
  expect(screen.queryByRole("button", { name: "Stop" })).toBeNull();
  await act(async () => fireEvent.click(screen.getByRole("button", { name: "Send" })));
  expect(prompt).toHaveBeenCalledWith("t1", { text: "number the rest" });
  expect(screen.queryByRole("button", { name: "Send" })).toBeNull();
  await act(async () => fireEvent.click(screen.getByRole("button", { name: "Stop" })));
  expect(cancel).toHaveBeenCalledWith("t1");
  expect(screen.getByRole("button", { name: "Send" })).toBeTruthy();
});

test("the title opens the item's href in the app window, then hides the card", () => {
  render(<NoticeCard reading={MACHINE_SEEDS["no-revit"]} fixture={false} />);
  show(asking);
  fireEvent.click(screen.getByRole("button", { name: /Pea wants approval/ }));
  expect(postMessage).toHaveBeenCalledWith(
    JSON.stringify({ type: "open-window", url: `${window.location.origin}/pea?thread=t1` }),
  );
  expect(postMessage).toHaveBeenLastCalledWith(JSON.stringify({ type: "notice-hide" }));
});

test("a permission answer goes to the thread's door; its item leaves only when the door accepts", async () => {
  permission.mockRejectedValueOnce(Error("no request r1")).mockResolvedValueOnce();
  render(<NoticeCard reading={MACHINE_SEEDS["no-revit"]} fixture={false} />);
  show(asking, revit);
  await act(async () => fireEvent.click(screen.getByRole("button", { name: "Allow once" })));
  expect(permission).toHaveBeenCalledWith("t1", "r1", "allow");
  expect(screen.getByText(/Pea did not take this answer: Error: no request r1/)).toBeTruthy();
  await act(async () => fireEvent.click(screen.getByRole("button", { name: "Allow once" })));
  // The other item stays: the card pages on.
  expect(screen.getByText("1/1")).toBeTruthy();
  expect(screen.getByText("Revit start succeeded")).toBeTruthy();
  expect(sent("notice-hide")).toBe(false);
});

test("a question is answered through the thread's question door, and the last item ends the card", async () => {
  question.mockResolvedValue();
  render(<NoticeCard reading={MACHINE_SEEDS["no-revit"]} fixture={false} />);
  show(level);
  await act(async () => fireEvent.click(screen.getByRole("button", { name: "Skip" })));
  expect(question).toHaveBeenCalledWith("t1", "q1", "decline", undefined);
  expect(card()).toBeNull();
  expect(postMessage).toHaveBeenLastCalledWith(JSON.stringify({ type: "notice-hide" }));
});

test("a fixture card refuses to answer or reply for Pea", () => {
  render(<NoticeCard reading={MACHINE_SEEDS["no-revit"]} fixture />);
  show(asking, finished);
  fireEvent.click(screen.getByRole("button", { name: "Allow once" }));
  expect(permission).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "next" }));
  fireEvent.change(screen.getByRole("textbox", { name: "reply to Pea" }), {
    target: { value: "go" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Send" }));
  expect(prompt).not.toHaveBeenCalled();
});
