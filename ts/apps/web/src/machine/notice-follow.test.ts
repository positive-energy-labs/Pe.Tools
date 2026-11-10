import { expect, test } from "vite-plus/test";
import { machineNoticeSchema } from "@pe/host-contracts/native-adapter";
import { readingFrameSchema, type NoticeRow } from "@pe/agent-contracts";

import { cardOf, followNotices, type NoticeSeen } from "./notice-follow";

type Fake = {
  url: string;
  onmessage: ((m: MessageEvent<string>) => void) | null;
  onerror: (() => void) | null;
  close: () => void;
};
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
  ({
    data: JSON.stringify(
      readingFrameSchema.parse({ kind: "snapshot", key: "k", value: { id: 9, tray, rows } }),
    ),
  }) as MessageEvent<string>;

function harness(seen: NoticeSeen | null, as?: "tray") {
  const streams: Fake[] = [];
  const raised: string[] = [];
  const records: NoticeSeen[] = [];
  const trays: boolean[] = [];
  const stop = followNotices({
    origin: "http://host",
    as,
    seen,
    onRow: (r) => raised.push(`${r.key}:${r.revision}`),
    onSeen: (s) => records.push(s),
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
  return { streams, raised, records, trays, stop };
}

test("a first follow records the feed and owes nothing earlier", () => {
  const h = harness(null);
  h.streams[0]!.onmessage!(feed([row("a"), row("b")]));
  expect(h.raised).toEqual([]);
  expect(h.records.at(-1)).toEqual({ a: 1, b: 1 });
  h.streams[0]!.onmessage!(feed([row("a"), row("b", 2), row("c")]));
  expect(h.raised).toEqual(["b:2", "c:1"]);
  h.stop();
});

test("a row raises once per revision; working rows and staged Work never raise", () => {
  const h = harness({});
  const working = row("w", 1, { group: "working", verb: "running" });
  const review = row("r", 1, { group: "waits", verb: "review" });
  h.streams[0]!.onmessage!(feed([row("a"), working, review]));
  h.streams[0]!.onmessage!(feed([row("a"), working, review]));
  expect(h.raised).toEqual(["a:1"]);
  h.stop();
});

test("a dropped stream reopens and raises exactly what moved while it was away", async () => {
  const h = harness({}, "tray");
  expect(new URL(h.streams[0]!.url).searchParams.get("keys")).toBe(
    JSON.stringify([{ kind: "notices", as: "tray" }]),
  );
  h.streams[0]!.onmessage!(feed([row("a"), row("b")]));
  h.streams[0]!.onerror!();
  await new Promise((r) => setTimeout(r, 5));
  h.streams[1]!.onmessage!(feed([row("a"), row("b", 3)], true));
  expect(h.raised).toEqual(["a:1", "b:1", "b:3"]);
  expect(h.trays).toEqual([false, true]);
  h.stop();
});

test("a malformed feed moves nothing", () => {
  const h = harness({});
  h.streams[0]!.onmessage!({
    data: JSON.stringify({ kind: "snapshot", key: "k", value: { tray: true } }),
  } as MessageEvent<string>);
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
