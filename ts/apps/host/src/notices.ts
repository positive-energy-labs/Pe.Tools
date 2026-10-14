import {
  readingKey,
  type HostLogEntry,
  type MachineNotice,
  type Receipt,
  type ReceiptQuery,
  type ReadingFrame,
  type ReadingRequest,
} from "@pe/agent-contracts";

import type { HostLog } from "./host-log.ts";

/**
 * The card feed is a projection of receipts, never a source of completion. A card exists because a
 * receipt revision says something a person who looked away wants to know; it settles nothing, and a
 * card that never shows leaves every action exactly as the receipt says. Each announced item is
 * appended to the host log, and the `notices` Reading serves the log from a follower's cursor, so
 * a tray that was away is handed exactly what it missed, once.
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
        title: finished ? title : `Pea stopped · ${title}`,
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
            title: candidateVersion ? `Pe.Tools ${candidateVersion} installed` : "Pe.Tools updated",
            body: "The update finished. The tray panel has the receipt.",
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

/**
 * Finished turns and Revit verb ends wait after the first of a burst, so a burst arrives as one
 * paged card. Updates, approvals and questions speak at once; an open ask also releases its thread's response.
 */
const BUFFER_MS = 30_000;
const SEEN = 256;

type Entry = { notice: MachineNotice; request: string; thread: string };
const asks = (r: Receipt) => r.body.kind === "permission" || r.body.kind === "question";
const noticesRequest = (request: ReadingRequest) =>
  request.kind === "notices" ? request : undefined;

export function createNotices(deps: {
  readonly source: {
    subscribe(query: ReceiptQuery, consume: (r: Receipt) => void): () => void;
  };
  readonly context: NoticeContext;
  readonly log: HostLog;
  readonly bufferMs?: number;
}) {
  const bufferMs = deps.bufferMs ?? BUFFER_MS;
  /** Highest revision accepted per receipt id: a duplicate or stale delivery is not a card. */
  const seen = new Map<string, number>();
  /** Answered requests, so a late delivery of the question cannot resurrect its card. */
  const answered = new Set<string>();
  const openRequests = new Map<string, string>();
  /** Accepted, not yet announced: the open buffer window. */
  let pending: Entry[] = [];
  let timer: ReturnType<typeof setTimeout> | undefined;

  function announce({ notice, request }: Entry) {
    deps.log.append({ kind: "notice", notice, ...(request ? { request } : {}) });
  }

  function flush() {
    timer = undefined;
    const burst = pending;
    pending = [];
    burst.forEach(announce);
  }

  function ingest(r: Receipt) {
    const body = r.body;
    if ((body.kind === "permission" || body.kind === "question") && body.phase === "resolved") {
      // The question was answered elsewhere: it must not show as a new card.
      const request = r.join.requestId;
      answered.add(request);
      openRequests.delete(request);
      if (answered.size > SEEN) answered.delete(answered.values().next().value!);
      pending = pending.filter((e) => e.request !== request);
      return;
    }
    if (asks(r) && answered.has(r.join.requestId)) return;
    const notice = noticeOf(r, deps.context);
    if (!notice || (seen.get(r.id) ?? -1) >= r.revision) return;
    seen.delete(r.id);
    seen.set(r.id, r.revision);
    if (seen.size > SEEN) seen.delete(seen.keys().next().value!);
    const thread = r.join.threadId ?? "";
    const entry = { notice, request: asks(r) ? r.join.requestId : "", thread };
    pending = pending.filter((e) => e.notice.id !== notice.id);
    if (asks(r)) {
      openRequests.set(r.join.requestId, thread);
      if (openRequests.size > SEEN) openRequests.delete(openRequests.keys().next().value!);
      announce(entry);
      // An ask and its response share one card now, instead of arriving 30 seconds apart.
      const related = pending.filter((e) => thread && e.thread === thread);
      pending = pending.filter((e) => !related.includes(e));
      related.forEach(announce);
      if (!pending.length) {
        clearTimeout(timer);
        timer = undefined;
      }
      return;
    }
    if (
      bufferMs <= 0 ||
      body.kind === "usage" ||
      (body.kind === "turn" && thread && [...openRequests.values()].includes(thread))
    )
      return announce(entry);
    pending.push(entry);
    timer ??= setTimeout(flush, bufferMs);
  }

  const unsubscribe = deps.source.subscribe({ kinds: [...KINDS] }, ingest);

  /** Who follows as the tray: a web surface offers an OS notification only when none does. */
  let trays = 0;
  const presence = new Set<() => void>();
  const presenceChanged = () => presence.forEach((listener) => listener());

  const isNotice = ({ event }: HostLogEntry) => event.kind === "notice";
  const isResolution = ({ event }: HostLogEntry) =>
    event.kind === "receipt" &&
    (event.receipt.body.kind === "permission" || event.receipt.body.kind === "question") &&
    event.receipt.body.phase === "resolved";

  /**
   * The `notices` Reading: every item announced after the follower's cursor, then each one live.
   * An ask answered after it was announced is not replayed.
   */
  function observe(
    request: ReadingRequest,
    publish: (frame: ReadingFrame) => void,
    after?: number | null,
  ): (() => void) | undefined {
    const notices = noticesRequest(request);
    if (!notices) return undefined;
    const key = readingKey(request);
    const release: Array<() => void> = [];
    if (notices.as === "tray") {
      trays++;
      presenceChanged();
      release.push(() => {
        trays--;
        presenceChanged();
      });
    } else {
      const say = () => publish({ kind: "snapshot", key, value: { tray: trays > 0 } });
      say();
      presence.add(say);
      release.push(() => presence.delete(say));
    }
    // A cursor the log never reached is a lost log, not a follower that is current.
    const replay =
      after == null || after > deps.log.last
        ? null
        : deps.log.read(after, (entry) => isNotice(entry) || isResolution(entry));
    if (!replay || replay.gap) publish({ kind: "gap", key, dropped: null, id: deps.log.last });
    else {
      const resolved = new Set(
        replay.entries.flatMap(({ event }) =>
          event.kind === "receipt" ? [event.receipt.join.requestId] : [],
        ),
      );
      for (const { id, event } of replay.entries)
        if (event.kind === "notice" && !(event.request && resolved.has(event.request)))
          publish({ kind: "event", key, value: event.notice, id });
    }
    // Read and subscribe run in one synchronous step, so no entry falls between them.
    release.push(
      deps.log.subscribe((entry) => {
        if (entry.event.kind === "notice")
          publish({ kind: "event", key, value: entry.event.notice, id: entry.id });
      }),
    );
    return () => release.forEach((fn) => fn());
  }

  return {
    observe,
    close: () => {
      unsubscribe();
      clearTimeout(timer);
      flush();
    },
  };
}
