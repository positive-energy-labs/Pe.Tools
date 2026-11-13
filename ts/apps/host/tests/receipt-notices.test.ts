/**
 * The one notice feed (ADR 0035 rule 7) over the host's own stores: the rows and their words, the
 * revisions people's followers key on, and the Reading that serves them. The receipt-to-card
 * projection this file used to test is deleted; receipts reach a person as feed rows.
 */
import { afterEach, expect, test, vi } from "vite-plus/test";
import {
  harnessEventSchema,
  actionReceiptSchema,
  held,
  noticeFeedSchema,
  type HarnessEvent,
  type NoticeFeed,
  type ReadingFrame,
} from "@pe/agent-contracts";
import { createNoticeFeed, noticeRows, type NoticeSources } from "../src/notice-feed.ts";
import { Effect } from "effect";
import { gatewayExecutor } from "../src/gateway-actions.ts";
import { detachedBridge, testJournal } from "./effect-test.ts";
import { approvedPea } from "./callers.ts";
import type { PictureCaptures } from "../src/captures-route.ts";
import { z } from "zod";

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
const receipt = (id: string, state: "failed" | "unknown" | "succeeded", revision = 1, error?: string) => ({
  revision,
  action: actionReceiptSchema.parse({
    id,
    key: "revit.ducts.resize",
    state,
    caller: { kind: "pea", context: "notice", thread: "t1" },
    startedAt: at,
    basis: null, target: { kind: "host" }, input: {}, steps: [],
    prepared: { state: "ready", value: null }, recovery: [],
    ...(state === "succeeded" ? { result: null } : { error: error ?? "Outcome unknown", status: 503 }),
  }),
});
const none: NoticeSources = { threads: [], receipts: [], works: [], machine: null, stored: [], held: [] };

test("a succeeded script's held result is one notice, with nothing pending", async () => {
  const journal = testJournal();
  const result = { status: "Succeeded", held: "Held, not done: the person presses Save in Revit." };
  const executor = gatewayExecutor("scripting.execute", detachedBridge(),
    () => Effect.succeed(result), {} as PictureCaptures);
  journal.bindCommands({ probe: async () => null, resolve: () => ({
    ...executor,
    definition: async () => ({ says: "Run script", needs: "nothing", effect: "command", dirties: [], input: z.record(z.string(), z.unknown()) }),
    bind: async () => ({ effects: [], prepare: async () => ({ kind: "host-leaf" }) }),
  }) });
  await journal.invoke({
    id: "script-held", key: "scripting.execute", target: { kind: "host" },
    input: { scriptContent: "doc.Save();" },
  }, { caller: approvedPea("script-held"), basis: null });
  const action = await journal.wait("script-held");
  expect(action).toMatchObject({ state: "succeeded", result });
  const now = Date.parse(action.startedAt);
  const rows = noticeRows({ ...none, receipts: [{ revision: 1, action }] }, now);
  expect(rows).toMatchObject([{
    key: "action:script-held", group: "waits", verb: "held", says: result.held,
  }]);
  expect(rows).toHaveLength(1);
  expect(action.state).toBe("succeeded");
  expect(action.recovery).toEqual([]);
  expect(action.steps).toMatchObject([{ state: "succeeded" }]);
  expect(action.refusal).toBeUndefined();
  if (action.state !== "succeeded") throw Error("script did not settle");
  expect(noticeRows({ ...none, receipts: [{ revision: 2, action: { ...action, result: { held: null } } }] }, now)).toEqual([]);
});

test.each(["stale", "invalid"] as const)("a %s tier-write refusal keeps its outcome verb in Failed", (kind) => {
  const action = actionReceiptSchema.parse({
    id: `tier-${kind}`, key: "settings.tiers.write", state: "failed",
    caller: { kind: "human", via: "local" }, startedAt: at,
    basis: null, target: { kind: "host" }, input: {}, steps: [],
    prepared: { state: "unprepared" }, recovery: [],
    error: "The setting changed since it was read.", status: 409, notDispatched: true,
    refusal: kind === "stale" ? { kind, consumed: [] } : { kind },
  });
  const [row] = noticeRows({ ...none, receipts: [{ revision: 1, action }] }, NOW);
  expect(row).toMatchObject({ group: "failed", verb: kind === "stale" ? "stale" : "refused" });
});

test("every source speaks in its own words, grouped waits, working, interrupted, failed, unread", () => {
  const rows = noticeRows(
    {
      ...none,
      threads: [
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
    "waits", "waits", "working", "interrupted", "failed", "failed", "unread",
  ]);
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

test("a held act is one row that waits on the person, in held words; only a held send carries Confirm", () => {
  const refusal = held("overwrite-or-discard", "project document 'Office'", "The person presses Save in Revit.");
  const door = (id: string, startedAt: string) => ({
    revision: 4,
    action: actionReceiptSchema.parse({
      basis: null, target: { kind: "host" }, input: {}, steps: [],
      prepared: { state: "unprepared" }, recovery: [],
      id,
      key: "instances.save",
      state: "failed",
      error: refusal.message,
      status: 409,
      notDispatched: true,
      caller: { kind: "pea", context: "notice", thread: "t1" },
      startedAt,
      refusal,
    }),
  });
  const outward = door("out", at);
  const sent = { ...outward, action: { ...outward.action, key: "family.attach-spec", refusal: held("send-outward", "'C:/p/spec.pdf'", "It waits.") } };
  const rows = noticeRows(
    {
      ...none,
      // A day-old held act has left the feed; its receipt still holds it.
      // A held send's receipt is not a second row: its held send is the one row, with Confirm.
      receipts: [door("h1", at), door("old", "2026-11-09T11:00:00.000Z"), sent],
      held: [
        { id: "s1", service: "llamaparse", path: "C:/p/spec.pdf", sha256: "a".repeat(64), pages: "1-5", at, thread: "t1" },
        { id: "s2", service: "llamaparse", path: "C:/p/spec.pdf", sha256: "b".repeat(64), pages: "6-9", at, thread: "t1" },
      ],
    },
    NOW,
  );
  expect(rows.map((row) => [row.key, row.group, row.verb])).toEqual([
    ["action:h1", "waits", "held"],
    ["held:s1", "waits", "held"],
    ["held:s2", "waits", "held"],
  ]);
  expect(rows[0]!.says).toMatch(/^Held, not done/);
  // Held is never worded as the person saying no.
  for (const row of rows) expect(row.says).not.toMatch(/refus|reject|declin|denied/i);
  expect(rows[0]!.act).toBeUndefined();
  // Two holds naming one file tell their Confirms apart by a detail the row shows.
  expect(rows[1]!.act).toEqual({ kind: "confirm-send", id: "s1", to: "LlamaCloud", detail: "pages 1-5" });
  expect(rows[2]!.act).toEqual({ kind: "confirm-send", id: "s2", to: "LlamaCloud", detail: "pages 6-9" });
  expect(rows[1]!.says).toContain("pages 1-5");
  noticeFeedSchema.parse({ id: 0, tray: false, rows });
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
