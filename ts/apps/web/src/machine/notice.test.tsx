// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vite-plus/test";
import type { MachineNotice } from "@pe/agent-contracts";
import type { NativeMessageEvent } from "@pe/host-contracts/native-adapter";

import { MACHINE_SEEDS } from "#/open/seeds";

import { NOTICE_DRAIN_MS, NoticeCard } from "./notice";
import { SNOOZE_MS } from "./notice-policy";

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
  title: "ducts",
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
let listeners: Set<(event: NativeMessageEvent) => void>;
const sent = (type: string) => postMessage.mock.calls.some(([m]) => JSON.parse(m).type === type);
const show = (...notices: MachineNotice[]) =>
  act(() =>
    notices.forEach((notice) =>
      listeners.forEach((receive) =>
        receive(new MessageEvent("message", { data: { type: "notice", notice } })),
      ),
    ),
  );
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
  listeners = new Set();
  window.chrome = {
    webview: {
      postMessage,
      addEventListener: (_event, receive) => void listeners.add(receive),
      removeEventListener: (_event, receive) => void listeners.delete(receive),
    },
  };
  for (const door of [permission, question, prompt, cancel]) door.mockReset();
  // The ledger is per-page storage; each test starts with none.
  const store = new Map<string, string>();
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    value: {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => void store.set(key, value),
    },
  });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  delete window.chrome;
});

test("the card tells the tray it can take notices only once it listens", () => {
  expect(listeners.size).toBe(0);
  render(<NoticeCard reading={MACHINE_SEEDS["no-revit"]} fixture />);
  expect(listeners.size).toBe(1);
  expect(postMessage).toHaveBeenCalledWith(JSON.stringify({ type: "notice-ready" }));
});

test("reply growth re-reports the card height to the native tray and releases the observer", () => {
  let resized: (() => void) | undefined;
  const observe = vi.fn();
  const disconnect = vi.fn();
  vi.stubGlobal(
    "ResizeObserver",
    class {
      constructor(callback: () => void) {
        resized = callback;
      }
      observe = observe;
      disconnect = disconnect;
    },
  );
  const view = render(<NoticeCard reading={MACHINE_SEEDS["no-revit"]} fixture />);
  show(finished);
  const root = screen.getByRole("status", { name: "notice" });
  expect(observe).toHaveBeenCalledWith(root, { box: "border-box" });
  const bounds = vi.spyOn(root, "getBoundingClientRect");
  bounds.mockReturnValue({ height: 102 } as DOMRect);
  act(() => {
    resized!();
  });
  expect(postMessage).toHaveBeenLastCalledWith(
    JSON.stringify({ type: "notice-card", height: 102 }),
  );
  fireEvent.change(screen.getByRole("textbox", { name: "reply to Pea" }), {
    target: { value: "First line\nSecond line\nThird line\nFourth line\nFifth line" },
  });
  bounds.mockReturnValue({ height: 193.5 } as DOMRect);
  act(() => {
    resized!();
  });
  expect(postMessage).toHaveBeenLastCalledWith(
    JSON.stringify({ type: "notice-card", height: 194 }),
  );
  bounds.mockReturnValue({ height: 102 } as DOMRect);
  act(() => {
    resized!();
  });
  expect(postMessage).toHaveBeenLastCalledWith(
    JSON.stringify({ type: "notice-card", height: 102 }),
  );
  view.unmount();
  expect(disconnect).toHaveBeenCalled();
});

test("malformed native notices never enter the card", () => {
  render(<NoticeCard reading={MACHINE_SEEDS["no-revit"]} fixture />);
  act(() =>
    listeners.forEach((receive) =>
      receive({ data: { type: "notice", notice: { id: "bad", revision: 1 } } }),
    ),
  );
  expect(card()).toBeNull();
  show(revit);
  expect(screen.getByText("1/1")).toBeTruthy();
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

test("a pending question and the same thread's later response remain two paged items", () => {
  vi.useFakeTimers();
  render(<NoticeCard reading={MACHINE_SEEDS["no-revit"]} fixture />);
  show(level);
  act(() => void vi.advanceTimersByTime(30_000));
  expect(card()).not.toBeNull();
  show(finished);
  expect(screen.getByText("1/2")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "next" }));
  expect(screen.getByText("2/2")).toBeTruthy();
  expect(screen.getByRole("textbox", { name: "reply to Pea" })).toBeTruthy();
  act(() => void vi.advanceTimersByTime(NOTICE_DRAIN_MS * 3));
  expect(screen.getByText("2/2")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "previous" }));
  expect(screen.getByText("Which level?")).toBeTruthy();
});

test("a reply preview opens by keyboard activation and exposes Markdown to the dialog", async () => {
  render(<NoticeCard reading={MACHINE_SEEDS["no-revit"]} fixture />);
  show(finished);
  const title = screen.getByRole("button", { name: "ducts" });
  title.focus();
  await act(async () => fireEvent.click(title));
  await waitFor(() => expect(screen.getByRole("dialog").textContent).toContain("41 of 43"));
  expect(sent("open-window")).toBe(false);
  fireEvent.click(screen.getByRole("button", { name: "Open thread" }));
  expect(sent("open-window")).toBe(true);
});

test("the drain cycles item to item, hover pauses it, and the card dies after the last", () => {
  vi.useFakeTimers();
  render(<NoticeCard reading={MACHINE_SEEDS["no-revit"]} fixture />);
  show(revit, finished);
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
  expect(screen.queryByText("41 of 43")).toBeNull();
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

test("a reply's title previews Markdown on hover without focusing or changing its reply", async () => {
  vi.useFakeTimers();
  render(<NoticeCard reading={MACHINE_SEEDS["no-revit"]} fixture />);
  show(finished, revit);
  const title = screen.getByRole("button", { name: "ducts" });
  const focus = document.activeElement;
  expect(screen.queryByText("41 of 43")).toBeNull();
  fireEvent.mouseEnter(title);
  fireEvent.mouseMove(title);
  await act(async () => vi.advanceTimersByTime(500));
  expect(screen.getByText("41 of 43").tagName).toBe("STRONG");
  expect(document.activeElement).toBe(focus);
  expect(screen.getByRole("textbox", { name: "reply to Pea" })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "next" }));
  expect(screen.queryByText("41 of 43")).toBeNull();
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

test("no card for the thread the window is showing and focused on, but one for another thread", () => {
  vi.spyOn(document, "hasFocus").mockReturnValue(true);
  history.replaceState(null, "", "/pea?thread=t1");
  try {
    render(<NoticeCard reading={MACHINE_SEEDS["no-revit"]} fixture />);
    show(finished);
    expect(card()).toBeNull();
    show({
      ...finished,
      id: "10000000-0000-4000-8000-000000000009",
      href: "/pea?thread=t2",
      act: { kind: "reply", threadId: "t2" },
    });
    expect(screen.getByText("1/1")).toBeTruthy();
  } finally {
    history.replaceState(null, "", "/");
    vi.restoreAllMocks();
  }
});

test("a dismissed card does not come back from a replay of the same revision", () => {
  render(<NoticeCard reading={MACHINE_SEEDS["no-revit"]} fixture />);
  show(revit);
  fireEvent.click(screen.getByRole("button", { name: "dismiss" }));
  expect(card()).toBeNull();
  show(revit);
  expect(card()).toBeNull();
  show({ ...revit, revision: 2 });
  expect(card()).not.toBeNull();
});

test("snooze takes the item off the card for an hour and it returns once", () => {
  vi.useFakeTimers();
  render(<NoticeCard reading={MACHINE_SEEDS["no-revit"]} fixture />);
  show(revit, asking);
  fireEvent.click(screen.getByRole("button", { name: "snooze for an hour" }));
  expect(screen.getByText("1/1")).toBeTruthy();
  expect(screen.getByText("Pea wants approval · ducts")).toBeTruthy();
  // Delivered again while snoozed, it stays away.
  show(revit);
  expect(screen.getByText("1/1")).toBeTruthy();
  act(() => void vi.advanceTimersByTime(SNOOZE_MS + 60_000));
  expect(screen.getByText("1/2")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "next" }));
  expect(screen.getByText("Revit start succeeded")).toBeTruthy();
});

test("the separate card honors the panel view supplied by the native window", () => {
  render(<NoticeCard reading={MACHINE_SEEDS["no-revit"]} fixture />);
  act(() =>
    listeners.forEach((receive) =>
      receive({
        data: {
          type: "notice",
          notice: finished,
          view: { visible: true, focused: true, pathname: "/pea", thread: "t1" },
        },
      }),
    ),
  );
  expect(card()).toBeNull();
  act(() =>
    listeners.forEach((receive) =>
      receive({
        data: {
          type: "notice",
          notice: { ...finished, revision: 2 },
          view: { visible: true, focused: false, pathname: "/pea", thread: "t1" },
        },
      }),
    ),
  );
  expect(card()).not.toBeNull();
});
