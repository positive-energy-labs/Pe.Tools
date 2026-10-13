import { Context, Layer } from "effect";
import { HttpRouter } from "effect/unstable/http";
import { expect, test } from "vite-plus/test";
import type {
  ActionReceipt,
  MachineNotice,
  Receipt,
  ReceiptQuery,
  ReceiptReader,
} from "@pe/agent-contracts";
import { receiptSchema } from "@pe/agent-contracts";
import { createNotices, noticeOf, type NoticeContext } from "../src/notices.ts";

const T0 = Date.parse("2026-10-13T12:00:00Z");
const at = (offsetMs = 0) => new Date(T0 + offsetMs).toISOString();
const uid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const THREAD = uid(900);
const ASK = uid(901);
const context: NoticeContext = {
  thread: (opaque) => (opaque === THREAD ? { id: "t1", title: "Wiring" } : undefined),
  permission: (r) =>
    r.join.requestId === ASK
      ? {
          threadId: "t1",
          requestId: "perm-text-id",
          body: "Delete the schedule",
          options: [{ optionId: "yes", name: "Allow", kind: "allow_once" }],
        }
      : undefined,
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
    title: "Pea finished · Wiring",
    href: "/chat?thread=t1",
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
  ).toMatchObject({ title: "Pea finished · a thread", href: undefined });

  expect(noticeOf(permission("resolved"), context)).toBeNull();
  expect(noticeOf(permission("asked"), context)).toMatchObject({
    title: "Pea wants approval · Wiring",
    body: "Delete the schedule",
    act: { kind: "permission", threadId: "t1", requestId: "perm-text-id" },
  });

  expect(noticeOf(update("available"), context)).toMatchObject({
    title: "Pe.Tools 0.9.0 is available",
    act: { kind: "automatic-updates" },
  });
  expect(noticeOf(update("applying"), context)).toBeNull();
  expect(noticeOf(update("finished", "succeeded"), context)?.title).toBe("Pe.Tools updated");
  expect(noticeOf(update("failed", "refused"), context)?.title).toBe("Pe.Tools update refused");
  expect(
    noticeOf(
      make(uid(5), 1, { requestId: uid(14) }, { kind: "diagnostic", code: "host.failed" }),
      context,
    ),
  ).toBeNull();
});

function harness(initial: Receipt[] = []) {
  const consumers = new Set<(r: Receipt) => void>();
  let reads = 0;
  const source: ReceiptReader = {
    read: async (query: ReceiptQuery) => {
      reads++;
      return initial.filter((r) => !query.after || r.at > query.after);
    },
    subscribe: (_query, consume) => {
      consumers.add(consume);
      return () => consumers.delete(consume);
    },
  };
  let clock = T0;
  const notices = createNotices({ source, context, now: () => clock });
  const web = HttpRouter.toWebHandler(notices.route.pipe(Layer.provideMerge(Layer.empty)), {
    disableLogger: true,
  });
  /** Connects, collects cards until `count` arrived (or the stream ends), then hangs up. */
  async function connect(count: number, afterOpen?: () => void) {
    const response = await web.handler(
      new Request("http://host/host/notices"),
      Context.empty() as never,
    );
    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    const cards: MachineNotice[] = [];
    let buffer = "";
    let opened = false;
    while (cards.length < count) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value);
      const parts = buffer.split("\n\n");
      buffer = parts.pop() ?? "";
      for (const part of parts) {
        if (part.startsWith(": open")) {
          if (!opened) {
            opened = true;
            afterOpen?.();
          }
        } else if (part.startsWith("data: ")) cards.push(JSON.parse(part.slice(6)));
      }
    }
    await reader.cancel();
    return cards;
  }
  return {
    connect,
    deliver: (r: Receipt) => consumers.forEach((consume) => consume(r)),
    advance: (ms: number) => (clock += ms),
    consumers,
    reads: () => reads,
    close: async () => {
      notices.close();
      await web.dispose();
    },
  };
}

test("a duplicate delivery is one card and a higher revision is its successor", async () => {
  const h = harness();
  try {
    const cards = await h.connect(2, () => {
      h.deliver(lifecycle("succeeded"));
      h.deliver(lifecycle("succeeded"));
      h.deliver(lifecycle("failed", uid(1), 2));
      h.deliver(lifecycle("succeeded", uid(1), 1));
    });
    expect(cards.map((c) => `${c.id}:${c.revision}`)).toEqual([`${uid(1)}:1`, `${uid(1)}:2`]);
  } finally {
    await h.close();
  }
});

test("a connection replays the bounded last minute from the durable read, once", async () => {
  const old = make(
    uid(6),
    1,
    { requestId: uid(15), threadId: THREAD },
    { kind: "turn", phase: "finished" },
    -61_000,
  );
  const h = harness([lifecycle("succeeded"), old, turn("finished")]);
  try {
    const first = await h.connect(2);
    expect(first.map((c) => c.id).sort()).toEqual([uid(1), uid(2)]);
    // A reconnect replays the same ring: the tray dedupes by id:revision, the host never re-reads.
    const again = await h.connect(2);
    expect(again.map((c) => `${c.id}:${c.revision}`).sort()).toEqual([
      `${uid(1)}:1`,
      `${uid(2)}:1`,
    ]);
    expect(h.reads()).toBe(1);
  } finally {
    await h.close();
  }
});

test("an answered permission does not replay as a live question", async () => {
  const h = harness([permission("asked"), turn("finished")]);
  try {
    h.deliver(permission("resolved", uid(3), 2));
    // The durable read is what holds the asked receipt; resolution must beat it to the ring.
    const cards = await h.connect(1);
    expect(cards.map((c) => c.id)).toEqual([uid(2)]);
  } finally {
    await h.close();
  }
});

test("a card older than the replay window is gone after the clock moves", async () => {
  const h = harness([lifecycle("succeeded")]);
  try {
    expect((await h.connect(1)).map((c) => c.id)).toEqual([uid(1)]);
    h.advance(61_000);
    const cards = await h.connect(1, () => h.deliver(turn("finished")));
    expect(cards.map((c) => c.id)).toEqual([uid(2)]);
  } finally {
    await h.close();
  }
});

test("closing the feed releases the receipt subscription", async () => {
  const h = harness();
  expect(h.consumers.size).toBe(1);
  await h.close();
  expect(h.consumers.size).toBe(0);
});
