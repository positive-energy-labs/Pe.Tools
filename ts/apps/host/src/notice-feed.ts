/**
 * The one notice feed (ADR 0035 rule 7): the host's `notices` Reading serves a `NoticeFeed`, every
 * row that needs a person or tells one what happened, grouped waits, working, interrupted, failed,
 * unread. Push (the tray card, the OS notification) and pull (home and tray Activity, Mod+Shift+K)
 * read these rows; nothing else projects receipts into cards or joins threads in the browser.
 * Sources, all host-owned: thread summaries and each waiting thread's open ask, action receipts,
 * Works with staged edits, and the Machine's attention lines.
 *
 * Plain functions, not Effect: this sits beside the thread store's Readings in the
 * `observeHostResource` island (ADR 0029 phase 5 converts them together).
 */
import {
  attention,
  NOTICE_GROUPS,
  readingKey,
  routeAddress,
  type ActionReceipt,
  type HarnessEvent,
  type HarnessThreadSummary,
  type Machine,
  type NavigationWork,
  type NoticeAct,
  type NoticeFeed,
  type NoticeRow,
  type ReadingFrame,
  type ReadingRequest,
} from "@pe/agent-contracts";
import { HOST_RESTARTED } from "@pe/agent-contracts/chat-state";
import { summarizeFailure } from "@pe/host-contracts/failure-summary";
import type { ThreadPresence } from "@pe/host-contracts/pe-api";

/**
 * A row as built. Its revision is its source's own durable counter (a thread's last seq, a
 * receipt's revision, a Work's revision), so a host restart moves no revision and raises no card.
 */
export type NoticeDraft = Omit<NoticeRow, "attended">;

export interface NoticeSources {
  readonly threads: readonly (HarnessThreadSummary & { readonly events: readonly HarnessEvent[] })[];
  /** Action receipts with their envelope's revision. */
  readonly receipts: readonly { readonly revision: number; readonly action: ActionReceipt }[];
  readonly works: readonly NavigationWork[];
  readonly machine: Machine | null;
}

/** A host-restart death leaves the feed after this long; Pea's thread list still holds it. */
const INTERRUPTED_FOR_MS = 24 * 3_600_000;

/** A waiting thread's open ask, in its own words, and the door that answers it. */
function openAsk(
  threadId: string,
  events: readonly HarnessEvent[],
): { verb: string; says: string; act: NoticeAct } | null {
  const resolved = new Set(
    events.flatMap((e) =>
      e.kind === "permission_resolved" || e.kind === "question_resolved" ? [e.requestId] : [],
    ),
  );
  const open = events.findLast(
    (e) =>
      (e.kind === "question_request" || e.kind === "permission_request") &&
      !resolved.has(e.requestId),
  );
  if (open?.kind === "question_request")
    return {
      verb: "asks",
      says: open.message,
      act: {
        kind: "question",
        threadId,
        requestId: open.requestId,
        requestedSchema: open.requestedSchema as Record<string, unknown>,
      },
    };
  if (open?.kind !== "permission_request") return null;
  const option = (kind: string) => {
    const found = open.options.find((o) => o.kind.startsWith(kind));
    return found ? { optionId: found.optionId } : undefined;
  };
  const reject = option("reject"),
    allow = option("allow");
  return {
    verb: "approve",
    says: open.toolCall.title ?? "a tool call",
    act: {
      kind: "consent",
      threadId,
      requestId: open.requestId,
      ...(open.deadline ? { deadline: open.deadline } : {}),
      ...(reject ? { reject } : {}),
      ...(allow ? { allow } : {}),
    },
  };
}

/** Pea's words in the thread's last turn: what an unread row says. */
function lastSaid(events: readonly HarnessEvent[]): string | null {
  const turn = events.findLast((e) => e.kind === "prompt")?.turnId;
  const text = events
    .flatMap((e) =>
      e.kind === "update" && e.turnId === turn && e.update.sessionUpdate === "agent_message_chunk"
        ? [(e.update as { content?: { type?: string; text?: string } }).content]
        : [],
    )
    .map((content) => (content?.type === "text" ? (content.text ?? "") : ""))
    .join("")
    .trim();
  return text || null;
}

function threadRow(thread: NoticeSources["threads"][number], now: number): NoticeDraft | null {
  const { state, pending, message } = thread.activity;
  const row = (group: NoticeDraft["group"], verb: string, says: string | null): NoticeDraft => ({
    key: `thread:${thread.id}`,
    group,
    revision: thread.lastSeq,
    verb,
    what: thread.title,
    where: thread.providerName,
    says,
    at: thread.updatedAt,
    url: routeAddress("pea").link({}, { thread: thread.id }),
  });
  if (state === "waiting" || pending > 0) {
    const ask = openAsk(thread.id, thread.events);
    return ask ? { ...row("waits", ask.verb, ask.says), act: ask.act } : row("waits", "asks", message);
  }
  if (state === "running") return row("working", "running", null);
  if (state === "failed" && message === HOST_RESTARTED)
    return now - Date.parse(thread.updatedAt) > INTERRUPTED_FOR_MS
      ? null
      : {
          ...row("interrupted", "interrupted", "The host restarted during this turn."),
          act: { kind: "resume", threadId: thread.id },
        };
  if (state === "failed") {
    const failure = summarizeFailure(message ?? "The turn failed.");
    // A harness that died keeps its stderr on the error event; that is the raw detail.
    const ended = thread.events.findLast((e) => e.kind === "error");
    const raw = ended?.kind === "error" ? ended.failure?.raw : undefined;
    const detail = raw || failure.detail;
    return { ...row("failed", "failed", failure.summary), ...(detail ? { detail } : {}) };
  }
  const unread = thread.lifecycle.explicitUnread || thread.lifecycle.readSeq < thread.lastSeq;
  return unread && thread.lastSeq > 0
    ? { ...row("unread", "done", lastSaid(thread.events)), act: { kind: "reply", threadId: thread.id } }
    : null;
}

/** Who admitted the action, in words: a principal, never a password. */
const callerWord = (caller: ActionReceipt["caller"]) =>
  caller.kind === "pea"
    ? "Pea"
    : caller.kind === "page"
      ? "a Page"
      : caller.kind === "external-mcp"
        ? caller.label
        : caller.kind;

const RECEIPT_GROUP: Partial<Record<ActionReceipt["state"], NoticeDraft["group"]>> = {
  unknown: "waits",
  incomplete: "waits",
  running: "working",
  failed: "failed",
};

function receiptRow({ revision, action: receipt }: NoticeSources["receipts"][number]): NoticeDraft | null {
  const group = RECEIPT_GROUP[receipt.state];
  if (!group) return null;
  const failure =
    "error" in receipt
      ? summarizeFailure(receipt.error)
      : {
          summary: "The outcome is not known. Check Revit before running it again.",
          door: null,
          detail: null,
        };
  return {
    key: `action:${receipt.id}`,
    group,
    revision,
    verb: receipt.state,
    what: receipt.key,
    where: callerWord(receipt.caller),
    says: failure.summary,
    at: receipt.startedAt,
    // The failure's door is the row's address; a receipt itself has no page yet.
    url: failure.door
      ? `${routeAddress("settings").link({ section: failure.door.section })}${failure.door.hash ? `#${failure.door.hash}` : ""}`
      : null,
    ...(failure.door ? {} : { refusal: "No address yet: this receipt has no page" }),
    ...(failure.detail ? { detail: failure.detail } : {}),
  };
}

/** Every row, group order first (waits and working lead), newest first inside a group. */
export function noticeRows(sources: NoticeSources, now: number): NoticeDraft[] {
  const rows: NoticeDraft[] = [
    ...(sources.machine ? attention(sources.machine) : []).map((line) => ({
      key: `machine:${line}`,
      group: "waits" as const,
      // The line is the key: a line that clears and returns is a new row.
      revision: 0,
      verb: "machine",
      what: line,
      where: "this computer",
      says: null,
      at: null,
      url: routeAddress("settings").link(),
    })),
    ...sources.threads
      .filter((thread) => thread.lifecycle.status === "active")
      .flatMap((thread) => threadRow(thread, now) ?? []),
    ...sources.receipts.flatMap((receipt) => receiptRow(receipt) ?? []),
    // Staged Work includes human edits and scope choices; it carries no proposal-actor count.
    ...sources.works
      .filter((work) => work.staged > 0)
      .map((work) => ({
        key: `work:${work.id}`,
        group: "waits" as const,
        revision: work.revision ?? 0,
        verb: "review",
        what: work.label,
        where: work.context,
        says: `${work.staged} staged change${work.staged === 1 ? "" : "s"} to review`,
        at: null,
        url: work.url,
        ...(work.url ? {} : { refusal: work.reason ?? "No resumable destination" }),
      })),
  ];
  return rows.sort(
    (a, b) =>
      NOTICE_GROUPS.indexOf(a.group) - NOTICE_GROUPS.indexOf(b.group) ||
      (b.at ?? "").localeCompare(a.at ?? ""),
  );
}

export interface NoticeFeedDeps {
  /** The rows now, from the host's own stores, and the host log id they were read at. */
  readonly build: () => { readonly id: number; readonly rows: readonly NoticeDraft[] };
  /** Fires whenever any source moved; the feed is rebuilt and published once per change. */
  readonly subscribe: (changed: () => void) => () => void;
}

export interface NoticeFeedReading {
  /** Serves `{ kind: "notices" }`; any other request is not this Reading's (undefined). */
  observe(
    request: ReadingRequest,
    publish: (frame: ReadingFrame) => void,
    after?: number | null,
  ): (() => void) | undefined;
  /** A surface's presence on a thread: a row for a thread someone is looking at is `attended`. */
  beat(caller: string, value: ThreadPresence): void;
  close(): void;
}

/** A presence beat lapses after this long without another. */
const BEAT_MS = 10_000;
/** Source changes inside this window build one feed. */
const SETTLE_MS = 50;

const threadOf = (row: NoticeRow) =>
  row.act && "threadId" in row.act
    ? row.act.threadId
    : row.key.startsWith("thread:")
      ? row.key.slice(7)
      : undefined;

export function createNoticeFeed(deps: NoticeFeedDeps): NoticeFeedReading {
  const followers = new Set<{ tray: boolean; send: (feed: NoticeFeed) => void }>();
  const beats = new Map<string, ThreadPresence & { at: number }>();
  let feed: ReturnType<NoticeFeedDeps["build"]> | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  /** The sources are watched only while someone follows; the last to leave lets them go. */
  let unsubscribe: (() => void) | undefined;
  const trays = () => [...followers].filter((follower) => follower.tray).length;
  /** Threads someone is looking at; a beat older than BEAT_MS is gone (expired on read). */
  const looking = () => {
    const now = Date.now();
    for (const [caller, beat] of beats) if (now - beat.at >= BEAT_MS) beats.delete(caller);
    return new Set([...beats.values()].map((beat) => beat.thread));
  };
  function publish(only?: "tray") {
    if (!followers.size) return;
    feed ??= deps.build();
    const { id, rows } = feed;
    const attended = looking();
    const tray = trays() > 0;
    for (const follower of followers) {
      if (only && !follower.tray) continue;
      follower.send({
        id,
        rows: rows.map((row) => {
          const thread = follower.tray ? threadOf(row) : undefined;
          return thread && attended.has(thread) ? { ...row, attended: true as const } : row;
        }),
        tray,
      });
    }
  }
  const changed = () => {
    // ponytail: a 50 ms settle, so a turn's end (its events, then its receipts) builds one feed.
    timer ??= setTimeout(() => {
      timer = undefined;
      feed = deps.build();
      publish();
    }, SETTLE_MS);
  };
  const release = () => {
    unsubscribe?.();
    unsubscribe = undefined;
    clearTimeout(timer);
    timer = undefined;
    feed = undefined;
  };

  return {
    observe(request, publish_, _after) {
      // A snapshot is the whole feed: there is nothing to replay from a cursor.
      if (request.kind !== "notices") return undefined;
      const key = readingKey(request);
      let last = "";
      const follower = {
        tray: request.as === "tray",
        send: (value: NoticeFeed) => {
          // Beats and rebuilds that change nothing this follower sees send nothing.
          const frame = JSON.stringify(value);
          if (frame === last) return;
          last = frame;
          publish_({ kind: "snapshot", key, value });
        },
      };
      followers.add(follower);
      unsubscribe ??= deps.subscribe(changed);
      // A tray arriving changes every follower's `tray`; anyone else gets only its own first frame.
      if (follower.tray) publish();
      else {
        feed ??= deps.build();
        follower.send({ id: feed.id, rows: [...feed.rows], tray: trays() > 0 });
      }
      return () => {
        followers.delete(follower);
        if (!followers.size) release();
        else if (follower.tray) publish();
      };
    },
    beat(caller, value) {
      if (value.visible && value.focused) beats.set(caller, { ...value, at: Date.now() });
      else beats.delete(caller);
      publish("tray");
    },
    close() {
      release();
      followers.clear();
    },
  };
}
