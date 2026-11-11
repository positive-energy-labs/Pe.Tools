import { expect, test } from "vite-plus/test";
import { machineNoticeSchema } from "@pe/host-contracts/native-adapter";
import { readingFrameSchema, type NoticeRow, type ReadingRequest } from "@pe/agent-contracts";

import { cardOf, followNotices, type NoticeSeen } from "./notice-follow";

const row = (key: string, revision = 1, extra: Partial<NoticeRow> = {}): NoticeRow => ({
  key,
  group: "failed",
  revision,
  verb: "failed",
  what: key,
  where: "Pea",
  says: null,
  at: null,
  url: null,
  ...extra,
});
/** Every frame is a real Reading frame carrying a real feed. */
const feed = (rows: NoticeRow[], tray = false) =>
  readingFrameSchema.parse({ kind: "snapshot", key: "k", value: { id: 9, tray, rows } });

type Options = Parameters<typeof followNotices>[0];
type Listener = Parameters<NonNullable<Options["readings"]>["subscribe"]>[1];

function harness(seen: NoticeSeen | null, as?: "tray") {
  const keys: { request: ReadingRequest; send: Listener }[] = [];
  const raised: string[] = [];
  const records: NoticeSeen[] = [];
  const trays: boolean[] = [];
  const stop = followNotices({
    as,
    seen,
    onRow: (r) => raised.push(`${r.key}:${r.revision}`),
    onSeen: (s) => records.push(s),
    onTray: (present) => trays.push(present),
    // The tab's one stream, stood in: the follower holds one key on it.
    readings: {
      subscribe: (request, send) => {
        keys.push({ request, send });
        return () => {};
      },
    },
  });
  return { keys, raised, records, trays, stop };
}

test("a first follow records the feed and owes nothing earlier", () => {
  const h = harness(null);
  h.keys[0]!.send(feed([row("a"), row("b")]));
  expect(h.raised).toEqual([]);
  expect(h.records.at(-1)).toEqual({ a: 1, b: 1 });
  h.keys[0]!.send(feed([row("a"), row("b", 2), row("c")]));
  expect(h.raised).toEqual(["b:2", "c:1"]);
  h.stop();
});

test("a row raises once per revision; working rows and staged Work never raise", () => {
  const h = harness({});
  const working = row("w", 1, { group: "working", verb: "running" });
  const review = row("r", 1, { group: "waits", verb: "review" });
  h.keys[0]!.send(feed([row("a"), working, review]));
  h.keys[0]!.send(feed([row("a"), working, review]));
  expect(h.raised).toEqual(["a:1"]);
  h.stop();
});

test("a dropped stream raises exactly what moved while it was away", () => {
  const h = harness({}, "tray");
  expect(h.keys.map((key) => key.request)).toEqual([{ kind: "notices", as: "tray" }]);
  h.keys[0]!.send(feed([row("a"), row("b")]));
  // The Readings owner fences, reconnects and answers the same key again; a retained feed that
  // is not current moves nothing.
  h.keys[0]!.send({ kind: "stale", key: "k" });
  h.keys[0]!.send({ ...feed([row("a", 9)]), stale: true });
  h.keys[0]!.send(feed([row("a"), row("b", 3)], true));
  expect(h.raised).toEqual(["a:1", "b:1", "b:3"]);
  expect(h.trays).toEqual([false, true]);
  h.stop();
});

test("a malformed feed moves nothing", () => {
  const h = harness({});
  h.keys[0]!.send({ kind: "snapshot", key: "k", value: { tray: true } });
  expect(h.raised).toEqual([]);
  expect(h.records).toEqual([]);
  h.stop();
});

test("a consent row becomes a card the native contract accepts, with its allow and reject doors", () => {
  const card = cardOf(
    row("thread:t1", 4, {
      group: "waits",
      verb: "approve",
      what: "Wiring",
      says: "Delete the schedule",
      url: "/pea?thread=t1",
      act: {
        kind: "consent",
        threadId: "t1",
        requestId: "r1",
        deadline: "2026-11-10T12:00:00.000Z",
        allow: { optionId: "allow_now" },
        reject: { optionId: "stop_writes" },
      },
    }),
  );
  expect(machineNoticeSchema.parse(card)).toEqual({
    id: "thread:t1",
    revision: 4,
    title: "Reject? Pea will write · Wiring",
    body: "Delete the schedule",
    href: "/pea?thread=t1",
    act: {
      kind: "permission",
      threadId: "t1",
      requestId: "r1",
      // The card's sweep counts down from the host's deadline.
      deadline: "2026-11-10T12:00:00.000Z",
      options: [
        { optionId: "allow_now", name: "Allow", kind: "allow_once" },
        { optionId: "stop_writes", name: "Reject", kind: "reject_once" },
      ],
    },
  });
});
