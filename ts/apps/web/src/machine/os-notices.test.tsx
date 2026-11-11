// @vitest-environment jsdom
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vite-plus/test";
import { readingFrameSchema, type NoticeRow } from "@pe/agent-contracts";

import { OsNotices, setOsNotices, useThreadPresence } from "./os-notices";
// The feed is a key on the tab's one Readings stream. Each follower is stood in as the key it
// asked for (`url` carries it) and the door its frames arrive through.
vi.mock("#/host/resource-stream", async (actual) => ({
  ...(await actual<typeof import("#/host/resource-stream")>()),
  peReadings: {
    subscribe: (request: unknown, listener: (frame: unknown) => void) => {
      streams.push({
        url: `/pe/resources?keys=${encodeURIComponent(JSON.stringify([request]))}`,
        onmessage: (message) => listener(JSON.parse(message.data)),
      });
      return () => {};
    },
    onResync: () => () => {},
    dirty: () => {},
  },
}));

/** Presence beats as the host sees them: the PUT bodies, through the real client and hostFetch. */
const beats: { thread: string | null; visible: boolean; focused: boolean }[] = [];
const recordBeats = () =>
  vi.stubGlobal("fetch", async (url: string | URL | Request, init?: RequestInit) => {
    if (String(url).includes("/pe/notices/presence/"))
      beats.push(JSON.parse(String(init?.body)) as (typeof beats)[number]);
    return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
  });

test("thread presence beats on focus and every 5 seconds, and stops on route departure", () => {
  vi.useFakeTimers();
  beats.length = 0;
  recordBeats();
  Object.defineProperty(document, "hasFocus", { configurable: true, value: () => true });
  function Surface({ thread }: { thread: string | null }) {
    useThreadPresence(thread);
    return null;
  }
  const view = render(<Surface thread="t1" />);
  expect(beats.at(-1)).toEqual({ thread: "t1", visible: true, focused: true });
  act(() => {
    vi.advanceTimersByTime(5_000);
  });
  expect(beats.length).toBe(2);
  Object.defineProperty(document, "hasFocus", { configurable: true, value: () => false });
  act(() => {
    window.dispatchEvent(new Event("blur"));
  });
  expect(beats.at(-1)).toEqual({ thread: "t1", visible: true, focused: false });
  view.rerender(<Surface thread="t2" />);
  expect(beats.at(-2)).toMatchObject({ thread: "t1", visible: false, focused: false });
  view.unmount();
  const count = beats.length;
  act(() => {
    vi.advanceTimersByTime(15_000);
  });
  expect(beats.length).toBe(count);
  expect(beats.at(-1)).toMatchObject({ thread: "t2", visible: false, focused: false });
  vi.useRealTimers();
});

/** The host's `notices` Reading as each follower sees it: real Reading frames on the stood-in stream. */
const streams: { url: string; onmessage: ((m: MessageEvent<string>) => void) | null }[] = [];
const send = (frame: unknown) =>
  act(() =>
    streams.at(-1)!.onmessage?.({
      data: JSON.stringify(readingFrameSchema.parse(frame)),
    } as MessageEvent<string>),
  );
const row = (key: string): NoticeRow => ({
  key,
  group: "unread",
  revision: 1,
  verb: "done",
  what: "ducts",
  where: "Claude",
  says: "Resized 41 of 43.",
  at: null,
  url: "/pea?thread=t1",
  act: { kind: "reply", threadId: "t1" },
});
/** The feed so far: each frame carries all of it, as the host sends it. */
let rows: NoticeRow[] = [];
let present = false;
const snapshot = () => ({ kind: "snapshot", key: "k", value: { id: 1, tray: present, rows } });
const item = (key: string) => {
  rows = [...rows, row(key)];
  send(snapshot());
};
const tray = (on: boolean) => {
  present = on;
  send(snapshot());
};

const raised: { title: string; options: NotificationOptions }[] = [];
let permission: NotificationPermission;

beforeEach(() => {
  streams.length = 0;
  raised.length = 0;
  rows = [];
  present = false;
  permission = "granted";
  // A surface that followed before: its first feed raises what moved, not a baseline.
  const store = new Map<string, string>([["pe.notices.os-seen", "{}"]]);
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    value: {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
    },
  });
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

test("a moved feed row becomes an OS notification only while no tray follows, once", async () => {
  render(<OsNotices />);
  await act(async () => void (await setOsNotices(true)));
  tray(true);
  item("n1");
  expect(raised).toEqual([]);
  tray(false);
  item("n2");
  expect(raised).toHaveLength(1);
  expect(raised[0]).toMatchObject({
    title: "ducts",
    options: { body: "Resized 41 of 43.", tag: "n2" },
  });
  // The same feed again (a reconnect, a rebuild) raises nothing: no row moved.
  send(snapshot());
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

test("two windows serialize delivery and reread the shared acknowledgement", async () => {
  const queues = new Map<string, Promise<unknown>>();
  const request = vi.fn((name: string, callback: () => unknown) => {
    const next = (queues.get(name) ?? Promise.resolve()).then(callback);
    queues.set(name, next);
    return next;
  });
  Object.defineProperty(navigator, "locks", { configurable: true, value: { request } });
  try {
    render(
      <>
        <OsNotices />
        <OsNotices />
      </>,
    );
    await act(async () => {
      await setOsNotices(true);
    });
    expect(streams).toHaveLength(2);
    await act(async () => {
      for (const stream of streams)
        stream.onmessage?.(
          new MessageEvent("message", {
            data: JSON.stringify({ ...snapshot(), value: { id: 1, tray: false, rows: [row("same-turn")] } }),
          }),
        );
      await Promise.all(queues.values());
    });
    expect(raised).toHaveLength(1);
    // A later feed and another local subscriber cannot announce that revision again.
    await act(async () => {
      for (const stream of streams)
        stream.onmessage?.(
          new MessageEvent("message", {
            data: JSON.stringify({ ...snapshot(), value: { id: 2, tray: false, rows: [row("same-turn")] } }),
          }),
        );
      await Promise.all(queues.values());
    });
    expect(raised).toHaveLength(1);
  } finally {
    Object.defineProperty(navigator, "locks", { configurable: true, value: undefined });
  }
});
