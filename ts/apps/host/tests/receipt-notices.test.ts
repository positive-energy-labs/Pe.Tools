import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test, vi } from "vite-plus/test";
import type {
  ActionReceipt,
  MachineNotice,
  Receipt,
  ReadingFrame,
  ReadingRequest,
} from "@pe/agent-contracts";
import { readingKey, receiptSchema } from "@pe/agent-contracts";
import { HostLog } from "../src/host-log.ts";
import { createNotices, noticeOf, type NoticeContext } from "../src/notices.ts";

const T0 = Date.parse("2026-10-13T12:00:00Z");
const at = (offsetMs = 0) => new Date(T0 + offsetMs).toISOString();
const uid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const THREAD = uid(900);
const ASK = uid(901);
const QUESTION = uid(902);
const TURN = uid(903);
const LEVELS = { type: "object", properties: { level: { type: "string" } } };
const context: NoticeContext = {
  thread: (opaque) => (opaque === THREAD ? { id: "t1", title: "Wiring" } : undefined),
  asked: (r) =>
    r.join.requestId === ASK
      ? {
          threadId: "t1",
          body: "Delete the schedule",
          act: {
            kind: "permission",
            threadId: "t1",
            requestId: "perm-text-id",
            options: [{ optionId: "yes", name: "Allow", kind: "allow_once" }],
          },
        }
      : r.join.requestId === QUESTION
        ? {
            threadId: "t1",
            body: "Which level?",
            act: {
              kind: "question",
              threadId: "t1",
              requestId: "q-text-id",
              message: "Which level?",
              requestedSchema: LEVELS,
            },
          }
        : undefined,
  said: (r) => (r.join.turnId === TURN ? "Retagged **41 of 43**." : undefined),
};
/** Every fixture is a real receipt: the schema, not a cast, says it is one. */
const make = (id: string, revision: number, join: object, body: object, atMs = 0): Receipt =>
  receiptSchema.parse({ schema: 1, id, revision, at: at(atMs), stamp: null, join, body });
const lifecycle = (
  state: "running" | "succeeded" | "failed",
  id = uid(1),
  revision = 1,
  key = "instances.start",
): Receipt =>
  ({
    ...make(id, revision, { requestId: uid(10) }, { kind: "diagnostic", code: "host.failed" }),
    body: {
      kind: "action",
      value: {
        key,
        state,
        ...(state === "failed" ? { error: "Revit never answered" } : {}),
      } as unknown as ActionReceipt,
    },
  }) as Receipt;
const turn = (phase: "started" | "finished" | "failed", id = uid(2), revision = 1): Receipt =>
  make(id, revision, { requestId: uid(11), threadId: THREAD }, { kind: "turn", phase });
const permission = (phase: "asked" | "resolved", id = uid(3), revision = 1): Receipt =>
  make(
    id,
    revision,
    { requestId: ASK, threadId: THREAD },
    { kind: "permission", phase, localRef: { threadId: "t1", eventId: "e1" } },
  );
const question = (phase: "asked" | "resolved", id = uid(8), revision = 1): Receipt =>
  make(
    id,
    revision,
    { requestId: QUESTION, threadId: THREAD },
    { kind: "question", phase, localRef: { threadId: "t1", eventId: "e2" } },
  );
const update = (
  phase: "available" | "applying" | "finished" | "failed",
  outcome?: "succeeded" | "failed" | "refused",
): Receipt =>
  make(
    uid(phase.length * 7 + (outcome?.length ?? 0)),
    1,
    { requestId: uid(12) },
    {
      kind: "usage",
      event: "update_outcome",
      counters: { phase, ...(outcome ? { outcome } : {}), candidateVersion: "0.9.0" },
    },
  );

test("each shared fact projects to one card and nothing else speaks", () => {
  expect(noticeOf(lifecycle("running"), context)).toBeNull();
  expect(noticeOf(lifecycle("succeeded"), context)).toMatchObject({
    id: uid(1),
    revision: 1,
    title: "Revit start succeeded",
    body: "Done.",
  });
  expect(noticeOf(lifecycle("failed"), context)?.body).toBe("Revit never answered");
  expect(noticeOf(lifecycle("succeeded", uid(1), 1, "family.build"), context)).toBeNull();

  expect(noticeOf(turn("started"), context)).toBeNull();
  expect(noticeOf(turn("finished"), context)).toMatchObject({
    title: "Wiring",
    href: "/pea?thread=t1",
  });
  expect(noticeOf(turn("failed"), context)?.title).toBe("Pea stopped · Wiring");
  // A thread this host no longer knows still gets a card, without a link it cannot honor.
  expect(
    noticeOf(
      make(
        uid(4),
        1,
        { requestId: uid(13), threadId: uid(999) },
        { kind: "turn", phase: "finished" },
      ),
      context,
    ),
  ).toMatchObject({ title: "a thread", href: undefined });

  expect(noticeOf(permission("resolved"), context)).toBeNull();
  expect(noticeOf(permission("asked"), context)).toMatchObject({
    title: "Pea wants approval · Wiring",
    body: "Delete the schedule",
    act: { kind: "permission", threadId: "t1", requestId: "perm-text-id" },
  });

  expect(noticeOf(question("resolved"), context)).toBeNull();
  expect(noticeOf(question("asked"), context)).toMatchObject({
    title: "Pea is asking · Wiring",
    body: "Which level?",
    href: "/pea?thread=t1",
    act: { kind: "question", threadId: "t1", requestId: "q-text-id", requestedSchema: LEVELS },
  });

  expect(noticeOf(update("available"), context)).toMatchObject({
    title: "Pe.Tools 0.9.0 is available",
    act: { kind: "automatic-updates" },
  });
  expect(noticeOf(update("applying"), context)).toBeNull();
  expect(noticeOf(update("finished", "succeeded"), context)?.title).toBe(
    "Pe.Tools 0.9.0 installed",
  );
  expect(noticeOf(update("failed", "refused"), context)?.title).toBe("Pe.Tools update refused");
  expect(
    noticeOf(
      make(uid(5), 1, { requestId: uid(14) }, { kind: "diagnostic", code: "host.failed" }),
      context,
    ),
  ).toBeNull();
});

test("a finished turn carries Pea's final response and the thread's reply door", () => {
  const finished = make(
    uid(7),
    1,
    { requestId: uid(16), threadId: THREAD, turnId: TURN },
    { kind: "turn", phase: "finished" },
  );
  expect(noticeOf(finished, context)).toMatchObject({
    title: "Wiring",
    body: "Retagged **41 of 43**.",
    href: "/pea?thread=t1",
    act: { kind: "reply", threadId: "t1" },
  });
  // A turn whose words this host never held still ends honestly, and a forgotten thread has no door.
  expect(noticeOf(turn("finished"), context)).toMatchObject({
    body: "The turn ended.",
    act: { kind: "reply", threadId: "t1" },
  });
  expect(
    noticeOf(
      make(
        uid(9),
        1,
        { requestId: uid(17), threadId: uid(999) },
        { kind: "turn", phase: "failed" },
      ),
      context,
    )?.act,
  ).toBeUndefined();
});

const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true })));

function harness(bufferMs = 0) {
  const dir = mkdtempSync(join(tmpdir(), "notices-"));
  dirs.push(dir);
  const log = new HostLog(dir);
  const consumers = new Set<(r: Receipt) => void>();
  const source = {
    subscribe: (_query: unknown, consume: (r: Receipt) => void) => {
      consumers.add(consume);
      return () => consumers.delete(consume);
    },
  };
  const notices = createNotices({ source, context, log, bufferMs });
  /** A follower: the frames it is handed, as the stream would carry them. */
  function follow(after: number | null = null, request: ReadingRequest = { kind: "notices" }) {
    const frames: ReadingFrame[] = [];
    const release = notices.observe(request, (frame) => frames.push(frame), after);
    const items = () =>
      frames.flatMap((f) => (f.kind === "event" ? [f.value as MachineNotice] : []));
    return {
      frames,
      items,
      ids: () => items().map((n) => `${n.id}:${n.revision}`),
      cursor: () =>
        frames.flatMap((f) => ("id" in f && f.id !== undefined ? [f.id] : [])).at(-1) ?? null,
      release: release ?? (() => {}),
    };
  }
  return {
    follow,
    beat: notices.beat,
    log,
    // The journal commits a receipt into the log and to its subscribers alike.
    deliver: (r: Receipt) => {
      log.append({ kind: "receipt", receipt: r });
      consumers.forEach((consume) => consume(r));
    },
    consumers,
    close: () => notices.close(),
  };
}

test("only a live focused beat for this thread attends the tray item; the log stays whole", () => {
  vi.useFakeTimers();
  const h = harness();
  try {
    const tray = h.follow(null, { kind: "notices", as: "tray" });
    const web = h.follow();
    h.beat("pwa", { thread: "t1", visible: true, focused: true });
    h.deliver(turn("finished"));
    expect(tray.items().at(-1)?.attended).toBe(true);
    expect(web.items().at(-1)?.attended).toBeUndefined();
    h.beat("pwa", { thread: "other-thread", visible: true, focused: true });
    h.deliver(turn("finished", uid(20)));
    expect(tray.items().at(-1)?.attended).toBeUndefined();
    h.beat("flyout", { thread: "t1", visible: true, focused: true });
    h.beat("pwa", { thread: "t1", visible: false, focused: false });
    h.deliver(turn("finished", uid(21)));
    expect(tray.items().at(-1)?.attended).toBe(true);
    vi.advanceTimersByTime(10_000);
    h.deliver(turn("finished", uid(22)));
    expect(tray.items().at(-1)?.attended).toBeUndefined();
    h.beat("flyout", { thread: "t1", visible: true, focused: false });
    h.deliver(turn("finished", uid(23)));
    expect(tray.items().at(-1)?.attended).toBeUndefined();
    expect(tray.items()).toHaveLength(5);
  } finally {
    h.close();
    vi.useRealTimers();
  }
});

test("a duplicate delivery is one card and a higher revision is its successor", () => {
  const h = harness();
  const reader = h.follow();
  h.deliver(lifecycle("succeeded"));
  h.deliver(lifecycle("succeeded"));
  h.deliver(lifecycle("failed", uid(1), 2));
  h.deliver(lifecycle("succeeded", uid(1), 1));
  expect(reader.ids()).toEqual([`${uid(1)}:1`, `${uid(1)}:2`]);
  h.close();
});

test("an ask flushes the waiting response and a response for its thread never waits behind it", () => {
  vi.useFakeTimers();
  const h = harness(30_000);
  try {
    const reader = h.follow();
    h.deliver(turn("finished"));
    expect(reader.items()).toEqual([]);
    h.deliver(question("asked"));
    expect(reader.ids()).toEqual([`${uid(8)}:1`, `${uid(2)}:1`]);
    h.deliver(turn("finished", uid(9)));
    expect(reader.ids()).toEqual([`${uid(8)}:1`, `${uid(2)}:1`, `${uid(9)}:1`]);
    vi.advanceTimersByTime(30_000);
    expect(reader.items()).toHaveLength(3);
    h.deliver(question("resolved", uid(8), 2));
    h.deliver(turn("finished", uid(10)));
    expect(reader.items()).toHaveLength(3);
    vi.advanceTimersByTime(30_000);
    expect(reader.items()).toHaveLength(4);
  } finally {
    h.close();
    vi.useRealTimers();
  }
});

test("a follower that was away for three notices is handed each once, in order, from its cursor", () => {
  const h = harness();
  const first = h.follow();
  h.deliver(lifecycle("succeeded", uid(1)));
  const cursor = first.cursor();
  expect(first.ids()).toEqual([`${uid(1)}:1`]);
  first.release();
  // The follower is offline for these three.
  h.deliver(turn("finished", uid(2)));
  h.deliver(lifecycle("failed", uid(4)));
  h.deliver(permission("asked", uid(3)));
  const back = h.follow(cursor);
  expect(back.ids()).toEqual([`${uid(2)}:1`, `${uid(4)}:1`, `${uid(3)}:1`]);
  // Following on from where it got to replays nothing; the next notice arrives live, once.
  const again = h.follow(back.cursor());
  expect(again.items()).toEqual([]);
  h.deliver(lifecycle("succeeded", uid(5)));
  expect(again.ids()).toEqual([`${uid(5)}:1`]);
  expect(back.ids()).toHaveLength(4);
  h.close();
});

test("no cursor, or one this log never reached, is a gap that carries the log's current id", () => {
  const h = harness();
  h.deliver(lifecycle("succeeded", uid(1)));
  const fresh = h.follow();
  expect(fresh.frames.filter((f) => f.kind === "gap")).toMatchObject([{ id: h.log.last }]);
  // A cursor from a lost log (ids restarted) would hide every new notice; it reads as a gap.
  const foreign = h.follow(h.log.last + 50);
  expect(foreign.frames.filter((f) => f.kind === "gap")).toMatchObject([{ id: h.log.last }]);
  h.deliver(turn("finished"));
  expect(fresh.ids()).toEqual([`${uid(2)}:1`]);
  h.close();
});

test("an ask answered while the follower was away is not replayed", () => {
  const h = harness();
  const cursor = h.follow().cursor() ?? h.log.last;
  h.deliver(permission("asked"));
  h.deliver(turn("finished"));
  h.deliver(permission("resolved", uid(3), 2));
  expect(h.follow(cursor).ids()).toEqual([`${uid(2)}:1`]);
  h.close();
});

test("an ask the follower sees live brings its held response with it", () => {
  const h = harness(200);
  const reader = h.follow();
  h.deliver(turn("finished"));
  h.deliver(permission("asked"));
  expect(reader.ids()).toEqual([`${uid(3)}:1`, `${uid(2)}:1`]);
  h.close();
});

test("a tray follower is visible to the others as a snapshot", () => {
  const h = harness();
  const web = h.follow();
  expect(web.frames).toContainEqual({
    kind: "snapshot",
    key: readingKey({ kind: "notices" }),
    value: { tray: false },
  });
  const tray = h.follow(null, { kind: "notices", as: "tray" });
  expect(web.frames.findLast((f) => f.kind === "snapshot")).toMatchObject({
    value: { tray: true },
  });
  expect(tray.frames.some((f) => f.kind === "snapshot")).toBe(false);
  tray.release();
  expect(web.frames.findLast((f) => f.kind === "snapshot")).toMatchObject({
    value: { tray: false },
  });
  h.close();
});

test("closing the feed releases the receipt subscription", () => {
  const h = harness();
  expect(h.consumers.size).toBe(1);
  h.close();
  expect(h.consumers.size).toBe(0);
});

test("a burst waits out one buffer window, but an ask never waits", async () => {
  const h = harness(200);
  const reader = h.follow();
  const start = performance.now();
  const arrived = new Map<string, number>();
  const note = () =>
    reader
      .items()
      .forEach((n) => arrived.has(n.id) || arrived.set(n.id, performance.now() - start));
  h.deliver(lifecycle("succeeded"));
  h.deliver(permission("asked"));
  note();
  setTimeout(() => h.deliver(turn("finished")), 100);
  setTimeout(() => h.deliver(question("asked")), 120);
  await new Promise((r) => setTimeout(r, 120));
  note();
  await new Promise((r) => setTimeout(r, 200));
  note();
  expect(arrived.get(uid(3))!).toBeLessThan(100);
  expect(arrived.get(uid(8))!).toBeGreaterThanOrEqual(110);
  expect(arrived.get(uid(8))!).toBeLessThan(180);
  // The response for the asking thread joins it immediately; unrelated lifecycle work stays buffered.
  expect(reader.items().map((c) => c.id)).toEqual([uid(3), uid(2), uid(8), uid(1)]);
  h.close();
});
