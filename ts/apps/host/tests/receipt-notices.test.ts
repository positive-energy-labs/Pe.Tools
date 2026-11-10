/**
 * The one notice feed (ADR 0035 rule 7) over the host's own stores: the rows and their words, the
 * revisions people's followers key on, and the Reading that serves them. The receipt-to-card
 * projection this file used to test is deleted; receipts reach a person as feed rows.
 */
import { afterEach, expect, test, vi } from "vite-plus/test";
import {
  harnessEventSchema,
  noticeFeedSchema,
  type ActionReceipt,
  type HarnessEvent,
  type NoticeFeed,
  type ReadingFrame,
} from "@pe/agent-contracts";
import { createNoticeFeed, noticeRows, type NoticeSources } from "../src/notice-feed.ts";

const NOW = Date.parse("2026-11-10T12:00:00Z");
const at = "2026-11-10T11:59:00.000Z";
const events = (...raw: object[]): HarnessEvent[] =>
  raw.map((e, i) => harnessEventSchema.parse({ seq: i + 1, at, turnId: "u1", ...e }));
/** Only the summary fields the feed reads; the thread store's summary carries more. */
const thread = (
  id: string,
  activity: { state: "idle" | "running" | "waiting" | "failed"; message?: string },
  log: HarnessEvent[] = [],
  readSeq = log.length,
) =>
  ({
    id,
    title: `thread ${id}`,
    providerName: "Claude",
    updatedAt: at,
    lastSeq: log.length,
    activity: { pending: 0, lastSeq: log.length, message: null, ...activity },
    lifecycle: { status: "active", explicitUnread: false, readSeq },
    events: log,
  }) as unknown as NoticeSources["threads"][number];
const receipt = (id: string, state: string, revision = 1, error?: string) => ({
  revision,
  action: {
    id,
    key: "revit.ducts.resize",
    state,
    caller: { kind: "pea" },
    startedAt: at,
    ...(error ? { error } : {}),
  } as unknown as ActionReceipt,
});
const none: NoticeSources = { threads: [], receipts: [], works: [], machine: null };

test("every source speaks in its own words, grouped waits, working, interrupted, failed, unread", () => {
  const rows = noticeRows(
    {
      ...none,
      threads: [
        thread(
          "ask",
          { state: "waiting" },
          events(
            { kind: "prompt", text: "write" },
            {
              kind: "permission_request",
              requestId: "r1",
              toolCall: { toolCallId: "w", title: "First write: Office.rvt" },
              options: [
                { optionId: "allow_now", name: "Allow", kind: "allow_once" },
                { optionId: "stop_writes", name: "Reject", kind: "reject_once" },
              ],
              deadline: "2026-11-10T12:01:00.000Z",
              scope: "run",
            },
          ),
        ),
        thread(
          "q",
          { state: "waiting" },
          events({
            kind: "question_request",
            requestId: "q1",
            message: "Which level?",
            requestedSchema: { type: "object" },
          }),
        ),
        thread("run", { state: "running" }, events({ kind: "prompt", text: "go" })),
        thread("cut", { state: "failed", message: "host restarted during this turn" }, events({ kind: "prompt", text: "go" })),
        thread(
          "died",
          { state: "failed", message: "The claude harness exited (code 3)." },
          events(
            { kind: "prompt", text: "go" },
            {
              kind: "error",
              message: "The claude harness exited (code 3).",
              failure: { kind: "other", message: "The claude harness exited (code 3).", raw: "[session/create] durationMs=79" },
            },
          ),
        ),
        thread(
          "done",
          { state: "idle" },
          events(
            { kind: "prompt", text: "resize" },
            { kind: "update", update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "Resized 41 of 43." } } },
            { kind: "turn_end", stopReason: "end_turn" },
          ),
          0,
        ),
      ],
      receipts: [
        receipt("a1", "failed", 3, "Revit never answered"),
        receipt("a2", "unknown"),
        receipt("a3", "succeeded"),
      ],
    },
    NOW,
  );
  const by = Object.fromEntries(rows.map((row) => [row.key, row]));
  expect(rows.map((row) => row.group)).toEqual([
    "waits", "waits", "waits", "working", "interrupted", "failed", "failed", "unread",
  ]);
  expect(by["thread:ask"]).toMatchObject({
    verb: "approve",
    says: "First write: Office.rvt",
    revision: 2,
    act: {
      kind: "consent",
      threadId: "ask",
      requestId: "r1",
      deadline: "2026-11-10T12:01:00.000Z",
      reject: { optionId: "stop_writes" },
      allow: { optionId: "allow_now" },
    },
  });
  expect(by["thread:q"]).toMatchObject({
    verb: "asks",
    says: "Which level?",
    act: { kind: "question", requestId: "q1", requestedSchema: { type: "object" } },
  });
  expect(by["thread:cut"]?.act).toEqual({ kind: "resume", threadId: "cut" });
  // A harness death says one sentence; its stderr is the detail to copy.
  expect(by["thread:died"]).toMatchObject({ verb: "failed", detail: "[session/create] durationMs=79" });
  expect(by["thread:done"]).toMatchObject({
    verb: "done",
    says: "Resized 41 of 43.",
    act: { kind: "reply", threadId: "done" },
  });
  expect(by["action:a1"]).toMatchObject({ group: "failed", revision: 3, where: "Pea" });
  expect(by["action:a2"]).toMatchObject({ group: "waits", verb: "unknown" });
  expect(by["action:a3"]).toBeUndefined();
  // Every row is the contract's.
  noticeFeedSchema.parse({ id: 0, tray: false, rows });
});

test("an answered ask is no longer one: the waiting thread asks in its own message", () => {
  const [row] = noticeRows(
    {
      ...none,
      threads: [
        thread(
          "t",
          { state: "waiting", message: "Waiting on a tool" },
          events(
            { kind: "question_request", requestId: "q1", message: "Which level?", requestedSchema: {} },
            { kind: "question_resolved", requestId: "q1", by: "user", action: "decline" },
          ),
        ),
      ],
    },
    NOW,
  );
  expect(row).toMatchObject({ verb: "asks", says: "Waiting on a tool" });
  expect(row?.act).toBeUndefined();
});

afterEach(() => vi.useRealTimers());

function reading(sources: () => NoticeSources) {
  let changed: (() => void) | undefined;
  let subscriptions = 0;
  const feed = createNoticeFeed({
    build: () => ({ id: 41, rows: noticeRows(sources(), NOW) }),
    subscribe: (fire) => {
      subscriptions++;
      changed = fire;
      return () => (changed = undefined);
    },
  });
  const follow = (as?: "tray") => {
    const frames: ReadingFrame[] = [];
    const release = feed.observe({ kind: "notices", ...(as ? { as } : {}) }, (f) => frames.push(f))!;
    const feeds = () => frames.map((f) => (f as { value: NoticeFeed }).value);
    return { frames, feeds, release };
  };
  return { feed, follow, change: () => changed?.(), watching: () => changed !== undefined, subscriptions: () => subscriptions };
}

test("a burst of source changes is one frame; a rebuild that changes nothing sends none", () => {
  vi.useFakeTimers();
  let now = thread("t", { state: "running" }, events({ kind: "prompt", text: "go" }));
  const h = reading(() => ({ ...none, threads: [now] }));
  const web = h.follow();
  expect(web.feeds()).toHaveLength(1);
  expect(web.feeds()[0]).toMatchObject({ id: 41, tray: false, rows: [{ key: "thread:t", group: "working", revision: 1 }] });
  // The turn ends: its events land, then the summary, then a receipt; one feed comes of them.
  now = thread("t", { state: "idle" }, events({ kind: "prompt", text: "go" }, { kind: "turn_end", stopReason: "end_turn" }), 1);
  h.change();
  h.change();
  h.change();
  vi.advanceTimersByTime(100);
  expect(web.feeds()).toHaveLength(2);
  expect(web.feeds()[1]?.rows[0]).toMatchObject({ group: "unread", revision: 2 });
  h.change();
  vi.advanceTimersByTime(100);
  expect(web.feeds()).toHaveLength(2);
  web.release();
  h.feed.close();
});

test("revisions are the sources' own: a restarted host builds the same revisions", () => {
  const sources = { ...none, threads: [thread("t", { state: "running" }, events({ kind: "prompt", text: "go" }))], receipts: [receipt("a", "failed", 5, "x")] };
  const first = reading(() => sources).follow().feeds()[0]!;
  const again = reading(() => sources).follow().feeds()[0]!;
  expect(again.rows.map((r) => r.revision)).toEqual(first.rows.map((r) => r.revision));
  expect(first.rows.map((r) => r.revision)).toEqual([1, 5]);
});

test("a tray follower says tray to everyone, and only its rows carry attended", () => {
  const h = reading(() => ({ ...none, threads: [thread("t", { state: "running" }, events({ kind: "prompt", text: "go" }))] }));
  const web = h.follow();
  const tray = h.follow("tray");
  expect(web.feeds().at(-1)?.tray).toBe(true);
  h.feed.beat("tab-1", { thread: "t", visible: true, focused: true });
  expect(tray.feeds().at(-1)?.rows[0]?.attended).toBe(true);
  expect(web.feeds().at(-1)?.rows[0]?.attended).toBeUndefined();
  h.feed.beat("tab-1", { thread: "t", visible: false, focused: false });
  expect(tray.feeds().at(-1)?.rows[0]?.attended).toBeUndefined();
  tray.release();
  expect(web.feeds().at(-1)?.tray).toBe(false);
  web.release();
});

test("the sources are watched only while someone follows", () => {
  const h = reading(() => none);
  expect(h.watching()).toBe(false);
  const a = h.follow();
  const b = h.follow();
  expect(h.subscriptions()).toBe(1);
  a.release();
  expect(h.watching()).toBe(true);
  b.release();
  expect(h.watching()).toBe(false);
  expect(h.feed.observe({ kind: "threads" }, () => {})).toBeUndefined();
});
