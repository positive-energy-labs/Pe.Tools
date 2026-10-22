// @vitest-environment jsdom
import type { MachineNotice } from "@pe/agent-contracts";
import type { NativeMessageEvent } from "@pe/host-contracts/native-adapter";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vite-plus/test";

import { MACHINE_SEEDS } from "#/open/seeds";

import { NoticeCard } from "./notice";

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
