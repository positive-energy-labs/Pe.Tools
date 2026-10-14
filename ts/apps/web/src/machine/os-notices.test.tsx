// @vitest-environment jsdom
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vite-plus/test";
import { readingFrameSchema } from "@pe/agent-contracts";
import { machineNoticeSchema } from "@pe/host-contracts/native-adapter";

import { OsNotices, setOsNotices, useThreadPresence } from "./os-notices";
const presenceCall = vi.hoisted(() =>
  vi.fn<(name: string, input: unknown) => Promise<{ ok: boolean }>>(async () => ({ ok: true })),
);
vi.mock("#/host/pe-client", () => ({ peClient: { call: presenceCall } }));

test("thread presence beats on focus and every 5 seconds, and stops on route departure", () => {
  vi.useFakeTimers();
  presenceCall.mockClear();
  Object.defineProperty(document, "hasFocus", { configurable: true, value: () => true });
  function Surface({ thread }: { thread: string | null }) {
    useThreadPresence(thread);
    return null;
  }
  const view = render(<Surface thread="t1" />);
  expect(presenceCall).toHaveBeenLastCalledWith("notices.presence", {
    params: { caller: expect.any(String) },
    body: { thread: "t1", visible: true, focused: true },
  });
  act(() => {
    vi.advanceTimersByTime(5_000);
  });
  expect(presenceCall).toHaveBeenCalledTimes(2);
  Object.defineProperty(document, "hasFocus", { configurable: true, value: () => false });
  act(() => {
    window.dispatchEvent(new Event("blur"));
  });
  expect(presenceCall.mock.calls.at(-1)).toEqual([
    "notices.presence",
    {
      params: { caller: expect.any(String) },
      body: { thread: "t1", visible: true, focused: false },
    },
  ]);
  view.rerender(<Surface thread="t2" />);
  expect(presenceCall.mock.calls.at(-2)?.[1]).toMatchObject({
    body: { thread: "t1", visible: false, focused: false },
  });
  view.unmount();
  const count = presenceCall.mock.calls.length;
  act(() => {
    vi.advanceTimersByTime(15_000);
  });
  expect(presenceCall).toHaveBeenCalledTimes(count);
  expect(presenceCall.mock.calls.at(-1)?.[1]).toMatchObject({
    body: { thread: "t2", visible: false, focused: false },
  });
  vi.useRealTimers();
});

/** The host's `notices` stream as the browser sees it: real Reading frames over a stand-in EventSource. */
const streams: { url: string; onmessage: ((m: MessageEvent<string>) => void) | null }[] = [];
const send = (frame: unknown) =>
  act(() =>
    streams.at(-1)!.onmessage?.({
      data: JSON.stringify(readingFrameSchema.parse(frame)),
    } as MessageEvent<string>),
  );
const notice = (id: string, revision = 1) =>
  machineNoticeSchema.parse({
    id,
    revision,
    title: "Pea finished · ducts",
    body: "Resized 41 of 43.",
    href: "/pea?thread=t1",
    act: { kind: "reply", threadId: "t1" },
  });
let logId = 0;
const item = (id: string) => send({ kind: "event", key: "k", value: notice(id), id: ++logId });
const tray = (present: boolean) => send({ kind: "snapshot", key: "k", value: { tray: present } });

const raised: { title: string; options: NotificationOptions }[] = [];
let permission: NotificationPermission;

beforeEach(() => {
  streams.length = 0;
  raised.length = 0;
  logId = 0;
  permission = "granted";
  const store = new Map<string, string>();
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    value: {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
    },
  });
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
  vi.stubGlobal(
    "Notification",
    class {
      static get permission() {
        return permission;
      }
      static requestPermission = async () => permission;
      onclick: (() => void) | null = null;
      constructor(title: string, options: NotificationOptions) {
        raised.push({ title, options });
      }
      close() {}
    },
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  Object.defineProperty(document, "hasFocus", { configurable: true, value: () => false });
  history.replaceState(null, "", "/");
});

test("nothing follows until the person opts in, and denial leaves it off", async () => {
  render(<OsNotices />);
  expect(streams).toHaveLength(0);
  permission = "denied";
  expect(await setOsNotices(true)).toBe("denied");
  expect(streams).toHaveLength(0);
  permission = "granted";
  await act(async () => void (await setOsNotices(true)));
  expect(streams).toHaveLength(1);
  expect(new URL(streams[0]!.url, "http://host").searchParams.get("keys")).toBe(
    JSON.stringify([{ kind: "notices" }]),
  );
});

test("a card item becomes an OS notification only while no tray follows, once", async () => {
  render(<OsNotices />);
  await act(async () => void (await setOsNotices(true)));
  tray(true);
  item("n1");
  expect(raised).toEqual([]);
  tray(false);
  item("n2");
  expect(raised).toHaveLength(1);
  expect(raised[0]).toMatchObject({
    title: "Pea finished · ducts",
    options: { body: "Resized 41 of 43.", tag: "n2" },
  });
  // The same revision again (a replay past the cursor) is already acknowledged.
  send({ kind: "event", key: "k", value: notice("n2"), id: ++logId });
  expect(raised).toHaveLength(1);
});

test("the thread the window is showing and focused on raises nothing", async () => {
  Object.defineProperty(document, "hasFocus", { configurable: true, value: () => true });
  history.replaceState(null, "", "/pea?thread=t1");
  render(<OsNotices />);
  await act(async () => void (await setOsNotices(true)));
  item("n1");
  expect(raised).toEqual([]);
});
