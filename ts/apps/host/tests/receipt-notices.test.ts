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
import { receiptSchema } from "@pe/agent-contracts";
import { HostLog } from "../src/host-log.ts";
import { createNotices, type NoticeContext } from "../src/notices.ts";

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

const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true })));

function harness(bufferMs = 0, noticeContext = context) {
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
  const notices = createNotices({ source, context: noticeContext, log, bufferMs });
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

test("an ask answered while the follower was away is not replayed", () => {
  const h = harness();
  const cursor = h.follow().cursor() ?? h.log.last;
  h.deliver(permission("asked"));
  h.deliver(turn("finished"));
  h.deliver(permission("resolved", uid(3), 2));
  expect(h.follow(cursor).ids()).toEqual([`${uid(2)}:1`]);
  h.close();
});

test("turn completion links exact shared Work and reports accepted commands still running", () => {
  const h = harness(0, {
    ...context,
    completed: () => ({
      completed: 2,
      running: 1,
      work: [
        { title: "Ducts ? Office", href: "/ducts?target=C%3A%2FOffice.rvt&thread=t1" },
        { title: "Family ? Door", href: "/family?target=C%3A%2FDoor.rfa&thread=t1" },
      ],
    }),
  });
  try {
    const reader = h.follow();
    h.deliver(turn("started"));
    expect(reader.items()).toHaveLength(0);
    h.deliver(turn("finished"));
    const [notice] = reader.items();
    expect(notice?.body).toContain("2 commands completed.");
    expect(notice?.body).toContain("1 command is still running; writes have not finished.");
    expect(notice?.body).toContain("[Ducts ? Office](/ducts?target=C%3A%2FOffice.rvt&thread=t1)");
    expect(notice?.body).toContain("[Family ? Door](/family?target=C%3A%2FDoor.rfa&thread=t1)");
    expect(notice?.href).toBe("/ducts?target=C%3A%2FOffice.rvt&thread=t1");
    h.deliver(turn("finished"));
    expect(reader.items()).toHaveLength(1);
  } finally {
    h.close();
  }
});
