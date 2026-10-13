import { Effect, PubSub, Stream } from "effect";
import { HttpRouter, HttpServerResponse as Response } from "effect/unstable/http";

import type { MachineNotice, Receipt, ReceiptReader } from "@pe/agent-contracts";

/**
 * The tray's card feed is a projection of receipts, never a source of completion. A card exists
 * because a receipt revision says something a person who looked away wants to know; it settles
 * nothing, and a card that never shows leaves every action exactly as the receipt says.
 */

type Act = NonNullable<MachineNotice["act"]>;

/**
 * What a card names that a receipt keeps local. Receipts carry opaque joins; the thread owner maps
 * them back to the ids and text only this host holds, and says nothing for a thread it forgot.
 */
export interface NoticeContext {
  thread(opaqueThreadId: string): { readonly id: string; readonly title: string } | undefined;
  /** An open permission or question: its words and the door that answers it. */
  asked(
    receipt: Receipt,
  ): { readonly threadId: string; readonly body: string; readonly act: Act } | undefined;
  /** Pea's final response for a turn receipt, in Markdown. */
  said(receipt: Receipt): string | undefined;
}

/** The receipts a card can come from: nothing else is read. */
const KINDS = ["action", "turn", "permission", "question", "usage"] as const;

const chatHref = (threadId: string | undefined) =>
  threadId ? `/pea?thread=${encodeURIComponent(threadId)}` : undefined;

/** Pure: one receipt revision to at most one card. Everything not listed here stays quiet. */
export function noticeOf(r: Receipt, context: NoticeContext): MachineNotice | null {
  const base = { id: r.id, revision: r.revision };
  const body = r.body;
  switch (body.kind) {
    case "action": {
      // Revit lifecycle verbs announce their end only; every other action stays quiet.
      const value = body.value;
      if (!value.key.startsWith("instances.") || value.state === "running") return null;
      return {
        ...base,
        title: `Revit ${value.key.slice("instances.".length)} ${value.state}`,
        body: "error" in value ? value.error : "Done.",
      };
    }
    case "turn": {
      if (body.phase === "started") return null;
      const thread = r.join.threadId ? context.thread(r.join.threadId) : undefined;
      const title = thread?.title ?? "a thread";
      const finished = body.phase === "finished";
      return {
        ...base,
        title: finished ? `Pea finished · ${title}` : `Pea stopped · ${title}`,
        body: context.said(r) || (finished ? "The turn ended." : "The turn ended with an error."),
        href: chatHref(thread?.id),
        ...(thread ? { act: { kind: "reply" as const, threadId: thread.id } } : {}),
      };
    }
    case "permission":
    case "question": {
      if (body.phase !== "asked") return null;
      const asked = context.asked(r);
      const title = (r.join.threadId && context.thread(r.join.threadId)?.title) || "a thread";
      return {
        ...base,
        title: `${body.kind === "permission" ? "Pea wants approval" : "Pea is asking"} · ${title}`,
        body:
          asked?.body ??
          (body.kind === "permission"
            ? "A tool call is waiting."
            : "Pea is waiting for an answer."),
        href: chatHref(asked?.threadId),
        ...(asked ? { act: asked.act } : {}),
      };
    }
    case "usage": {
      if (body.event !== "update_outcome") return null;
      const { phase, outcome, candidateVersion } = body.counters;
      if (phase === "available")
        return {
          ...base,
          title: `Pe.Tools ${candidateVersion ?? "update"} is available`,
          body: "Automatic updates are off. Update from the tray panel.",
          act: { kind: "automatic-updates" },
        };
      // Applying and restarting are progress, not an ending; the settled revision speaks.
      if (phase !== "finished" && phase !== "failed") return null;
      return outcome === "succeeded"
        ? {
            ...base,
            title: "Pe.Tools updated",
            body: "Installed while no Revit was open.",
            act: { kind: "automatic-updates" },
          }
        : {
            ...base,
            title: `Pe.Tools update ${outcome ?? "failed"}`,
            body: "Read the receipt in the tray panel.",
          };
    }
    default:
      return null;
  }
}

const REPLAY_MS = 60_000;
/** Cards wait this long after the first of a burst, so a burst arrives as one paged card. */
const BUFFER_MS = 30_000;
const RING = 16;
const SEEN = 256;

type Entry = { notice: MachineNotice; atMs: number; request: string };
const asks = (r: Receipt) => r.body.kind === "permission" || r.body.kind === "question";

export function createNotices(deps: {
  readonly source: ReceiptReader;
  readonly context: NoticeContext;
  readonly replayMs?: number;
  readonly bufferMs?: number;
  readonly now?: () => number;
  readonly onFault?: (error: unknown) => void;
}) {
  const now = deps.now ?? Date.now;
  const replayMs = deps.replayMs ?? REPLAY_MS;
  const bufferMs = deps.bufferMs ?? BUFFER_MS;
  const hub = Effect.runSync(PubSub.unbounded<MachineNotice>());
  /** Highest revision accepted per receipt id: a duplicate or stale delivery is not a card. */
  const seen = new Map<string, number>();
  /** Answered requests, so a late delivery of the question cannot resurrect its card. */
  const answered = new Set<string>();
  const ring: Entry[] = [];
  /** Accepted, not yet published: the open buffer window. */
  let pending: Entry[] = [];
  let timer: ReturnType<typeof setTimeout> | undefined;

  function flush() {
    timer = undefined;
    const burst = pending;
    pending = [];
    for (const entry of burst) {
      const same = ring.findIndex((e) => e.notice.id === entry.notice.id);
      if (same >= 0) ring.splice(same, 1);
      ring.push(entry);
      if (ring.length > RING) ring.shift();
      Effect.runSync(PubSub.publish(hub, entry.notice));
    }
  }

  function ingest(r: Receipt) {
    const body = r.body;
    if ((body.kind === "permission" || body.kind === "question") && body.phase === "resolved") {
      // The question was answered elsewhere: it must not show, nor replay as a live request.
      const request = r.join.requestId;
      answered.add(request);
      if (answered.size > SEEN) answered.delete(answered.values().next().value!);
      pending = pending.filter((e) => e.request !== request);
      for (let i = ring.length - 1; i >= 0; i--)
        if (ring[i]!.request === request) ring.splice(i, 1);
      return;
    }
    if (asks(r) && answered.has(r.join.requestId)) return;
    const notice = noticeOf(r, deps.context);
    if (!notice || (seen.get(r.id) ?? -1) >= r.revision) return;
    seen.delete(r.id);
    seen.set(r.id, r.revision);
    if (seen.size > SEEN) seen.delete(seen.keys().next().value!);
    const at = Date.parse(r.at);
    pending = pending.filter((e) => e.notice.id !== notice.id);
    pending.push({
      notice,
      atMs: Number.isFinite(at) ? at : now(),
      request: asks(r) ? r.join.requestId : "",
    });
    if (bufferMs <= 0) flush();
    else timer ??= setTimeout(flush, bufferMs);
  }

  const unsubscribe = deps.source.subscribe({ kinds: [...KINDS] }, ingest);
  // The durable read is what lets a successor host announce what its predecessor left open.
  const ready = deps.source
    .read({ kinds: [...KINDS], after: new Date(now() - replayMs).toISOString() })
    .then((receipts) =>
      [...receipts].sort((a, b) => Date.parse(a.at) - Date.parse(b.at)).forEach(ingest),
    )
    .catch((error: unknown) => deps.onFault?.(error));

  const key = (n: MachineNotice) => `${n.id}:${n.revision}`;
  const encoder = new TextEncoder();
  const frame = (n: MachineNotice) => encoder.encode(`data: ${JSON.stringify(n)}\n\n`);

  /** The tray's card feed: SSE, one `data:` line per item; replay is the bounded last minute. */
  const route = HttpRouter.add("GET", "/host/notices", () =>
    Effect.succeed(
      Response.stream(
        Stream.unwrap(
          Effect.gen(function* () {
            // Subscribe before the replay snapshot so no card falls between the two.
            const live = yield* PubSub.subscribe(hub);
            yield* Effect.promise(() => ready);
            const replay = ring.filter((e) => now() - e.atMs < replayMs).map((e) => e.notice);
            const sent = new Set(replay.map(key));
            return Stream.make(encoder.encode(": open\n\n"), ...replay.map(frame)).pipe(
              Stream.concat(
                Stream.fromSubscription(live).pipe(
                  Stream.filter((n) => !sent.has(key(n))),
                  Stream.map(frame),
                ),
              ),
            );
          }),
        ),
        {
          contentType: "text/event-stream",
          headers: { "cache-control": "no-cache", connection: "keep-alive" },
        },
      ),
    ),
  );

  return {
    route,
    close: () => {
      unsubscribe();
      clearTimeout(timer);
    },
  };
}
export type Notices = ReturnType<typeof createNotices>;
