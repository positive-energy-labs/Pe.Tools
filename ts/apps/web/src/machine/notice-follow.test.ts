import { expect, test } from "vite-plus/test";
import { readingFrameSchema, type MachineNotice } from "@pe/agent-contracts";

import { followNotices } from "./notice-follow";

type Fake = {
  url: string;
  onmessage: ((m: MessageEvent<string>) => void) | null;
  onerror: (() => void) | null;
  close: () => void;
};
const item = (id: string): MachineNotice => ({ id, revision: 1, title: id, body: "" });
/** Every frame is a real Reading frame: the contract says so before the follower sees it. */
const frame = (value: unknown) =>
  ({ data: JSON.stringify(readingFrameSchema.parse(value)) }) as MessageEvent<string>;
const event = (id: number, value: unknown) => frame({ kind: "event", key: "k", value, id });

function harness(cursor: number | null) {
  const streams: Fake[] = [];
  const items: string[] = [];
  const cursors: number[] = [];
  const trays: boolean[] = [];
  const stop = followNotices({
    origin: "http://host",
    cursor,
    onNotice: (n) => items.push(n.id),
    onCursor: (id) => cursors.push(id),
    onTray: (present) => trays.push(present),
    retryMs: 0,
    open: (url) => {
      const fake: Fake = { url, onmessage: null, onerror: null, close: () => {} };
      streams.push(fake);
      return fake as unknown as ReturnType<
        NonNullable<Parameters<typeof followNotices>[0]["open"]>
      >;
    },
  });
  return { streams, items, cursors, trays, stop };
}

test("a surface that was away resumes after its cursor and handles each item once", async () => {
  const h = harness(4);
  expect(new URL(h.streams[0]!.url).searchParams.get("after")).toBe("4");
  h.streams[0]!.onmessage!(event(5, item("a")));
  h.streams[0]!.onmessage!(event(5, item("a")));
  h.streams[0]!.onmessage!(event(3, item("old")));
  h.streams[0]!.onmessage!(event(6, item("b")));
  expect(h.items).toEqual(["a", "b"]);
  expect(h.cursors).toEqual([5, 6]);
  // The stream drops: the next one resumes after the last id handled.
  h.streams[0]!.onerror!();
  await new Promise((r) => setTimeout(r, 5));
  expect(new URL(h.streams[1]!.url).searchParams.get("after")).toBe("6");
  h.stop();
});

test("a first follow has no cursor and a gap sets it without raising an item", () => {
  const h = harness(null);
  expect(new URL(h.streams[0]!.url).searchParams.has("after")).toBe(false);
  h.streams[0]!.onmessage!(frame({ kind: "gap", key: "k", dropped: null, id: 12 }));
  expect(h.items).toEqual([]);
  expect(h.cursors).toEqual([12]);
  h.streams[0]!.onmessage!(event(13, item("a")));
  expect(h.items).toEqual(["a"]);
  h.stop();
});

test("tray presence arrives as a snapshot and a malformed item moves the cursor but not the card", () => {
  const h = harness(0);
  h.streams[0]!.onmessage!(frame({ kind: "snapshot", key: "k", value: { tray: true } }));
  h.streams[0]!.onmessage!(event(1, { nope: true }));
  expect(h.trays).toEqual([true]);
  expect(h.items).toEqual([]);
  expect(h.cursors).toEqual([1]);
  h.stop();
});
