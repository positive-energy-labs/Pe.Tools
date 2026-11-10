// @vitest-environment jsdom
import { readingFrameSchema, type NoticeRow } from "@pe/agent-contracts";
import type { NativeMessageEvent } from "@pe/host-contracts/native-adapter";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vite-plus/test";

import { MACHINE_SEEDS } from "#/design-system/open-examples";

import { NoticeCard } from "./notice";

const permission = vi.fn<(id: string, requestId: string, optionId: string) => Promise<void>>();
const question =
  vi.fn<(id: string, requestId: string, action: string, content?: object) => Promise<void>>();
const prompt = vi.fn<(id: string, input: { text: string }) => Promise<{ turnId: string }>>();
const cancel = vi.fn<(id: string) => Promise<void>>();
vi.mock("#/workbench/provider/harness-client", async (actual) => ({
  ...(await actual<typeof import("#/workbench/provider/harness-client")>()),
  harnessClient: () => ({ permission, question, prompt, cancel }),
}));

const base = { group: "waits", revision: 1, where: "Claude", at: null, url: "/pea?thread=t1" } as const;
const asking: NoticeRow = {
  ...base,
  key: "thread:t1",
  verb: "approve",
  what: "ducts",
  says: "pe_do revit.ducts.resize",
  act: {
    kind: "consent",
    threadId: "t1",
    requestId: "r1",
    allow: { optionId: "allow" },
    reject: { optionId: "deny" },
  },
};
const finished: NoticeRow = {
  ...base,
  key: "thread:t2",
  group: "unread",
  verb: "done",
  what: "ducts",
  says: "Resized **41 of 43** ducts.",
  act: { kind: "reply", threadId: "t1" },
};
const revit: NoticeRow = {
  ...base,
  key: "action:a3",
  group: "failed",
  verb: "failed",
  what: "revit.start",
  where: "Pea",
  says: "Revit never answered",
  url: null,
};
const level: NoticeRow = {
  ...base,
  key: "thread:t4",
  verb: "asks",
  what: "ducts",
  says: "Which level?",
  act: {
    kind: "question",
    threadId: "t1",
    requestId: "q1",
    requestedSchema: { type: "object", properties: { level: { type: "string" } } },
  },
};

let postMessage: ReturnType<typeof vi.fn<(message: string) => void>>;
let listeners: Set<(event: NativeMessageEvent) => void>;
const sent = (type: string) => postMessage.mock.calls.some(([m]) => JSON.parse(m).type === type);
/** The host's notice feed as the card's follower sees it: each frame is the whole feed. */
let streams: { url: string; onmessage: ((m: MessageEvent<string>) => void) | null }[];
const feed = (value: unknown) =>
  act(() =>
    streams.at(-1)!.onmessage?.({
      data: JSON.stringify(readingFrameSchema.parse({ kind: "snapshot", key: "k", value })),
    } as MessageEvent<string>),
  );
const show = (...rows: NoticeRow[]) => feed({ id: 1, tray: true, rows });
const card = () => screen.queryByRole("status", { name: "notice" });
beforeEach(() => {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  streams = [];
  vi.stubGlobal(
    "EventSource",
    class {
      onmessage: ((m: MessageEvent<string>) => void) | null = null;
      onerror: (() => void) | null = null;
      constructor(public url: string) {
        streams.push(this);
      }
      close() {}
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
  // A card that followed before: its first feed raises what moved, not a baseline.
  const store = new Map<string, string>([["pe.notices.card-seen", "{}"]]);
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

test("the card follows the feed as the tray, and a malformed feed never enters it", () => {
  render(<NoticeCard reading={MACHINE_SEEDS["no-revit"]} fixture />);
  expect(new URL(streams[0]!.url, "http://host").searchParams.get("keys")).toBe(
    JSON.stringify([{ kind: "notices", as: "tray" }]),
  );
  feed({ id: 1, tray: true, rows: [{ key: "bad", revision: 1 }] });
  expect(card()).toBeNull();
  show(revit);
  expect(screen.getByText("1/1")).toBeTruthy();
});

test("a permission answer goes to the thread's door; its item leaves only when the door accepts", async () => {
  permission.mockRejectedValueOnce(Error("no request r1")).mockResolvedValueOnce();
  render(<NoticeCard reading={MACHINE_SEEDS["no-revit"]} fixture={false} />);
  show(asking, revit);
  await act(async () => fireEvent.click(screen.getByRole("button", { name: "Allow" })));
  expect(permission).toHaveBeenCalledWith("t1", "r1", "allow");
  expect(screen.getByText(/Pea did not take this answer: Error: no request r1/)).toBeTruthy();
  await act(async () => fireEvent.click(screen.getByRole("button", { name: "Allow" })));
  // The other item stays: the card pages on.
  expect(screen.getByText("1/1")).toBeTruthy();
  expect(screen.getByText("revit.start · failed")).toBeTruthy();
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
  fireEvent.click(screen.getByRole("button", { name: "Allow" }));
  expect(permission).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "next" }));
  fireEvent.change(screen.getByRole("textbox", { name: "reply to Pea" }), {
    target: { value: "go" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Send" }));
  expect(prompt).not.toHaveBeenCalled();
});

test("a row someone is looking at (attended) raises no card", () => {
  render(<NoticeCard reading={MACHINE_SEEDS["no-revit"]} fixture />);
  show({ ...finished, attended: true });
  expect(card()).toBeNull();
});

test("a first follow records the feed and raises nothing earlier", () => {
  window.localStorage.setItem("pe.notices.card-seen", "null");
  render(<NoticeCard reading={MACHINE_SEEDS["no-revit"]} fixture />);
  show(revit);
  expect(card()).toBeNull();
  show(revit, finished);
  expect(screen.getByText("1/1")).toBeTruthy();
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
