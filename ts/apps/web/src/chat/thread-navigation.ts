import {
  emptyThreadLifecycle,
  resolveCallTarget,
  targetKey,
  address,
  type DocumentRequest,
  type HarnessThreadBody,
  type HarnessThreadSummary,
  type TargetInventory,
  type UpdateThreadRequest,
  emptyThreadHead,
  type ThreadHead,
} from "@pe/agent-contracts";

export type ThreadShelf = "active" | "pinned" | "snoozed" | "settled" | "archived";
/** The roster (everything not archived) or the archive; shelves, not filters, sort the rest. */
export type ThreadFilter = "inbox" | "all" | "archived";

/** Inbox observes work in flight and answers the user has not read; pinning alone is not work. */
export function inThreadInbox(thread: HarnessThreadSummary, now = Date.now()): boolean {
  if (thread.activity.state === "running") return true;
  const shelf = shelfOf(thread, now);
  if (shelf === "archived" || shelf === "snoozed") return false;
  return (
    thread.activity.pending > 0 ||
    thread.activity.state === "waiting" ||
    thread.activity.state === "failed" ||
    isUnread(thread)
  );
}
export function relativeThreadAge(at: string, now = Date.now()): string {
  const timestamp = Date.parse(at);
  if (!Number.isFinite(timestamp)) return "—";
  const minutes = Math.max(0, Math.floor((now - timestamp) / 60_000));
  return minutes === 0
    ? "now"
    : minutes < 60
      ? `${minutes}m`
      : minutes < 1440
        ? `${Math.floor(minutes / 60)}h`
        : `${Math.floor(minutes / 1440)}d`;
}
export const navigationTargetKey = (target: HarnessThreadSummary["head"]["defaultTarget"]) =>
  JSON.stringify(
    target === null
      ? null
      : target.kind === "open"
        ? ["open", target.ref.session, target.ref.openId]
        : ["named", target.session, target.address],
  );
/** Which half of a saved target the live inventory lacks: the whole session, or just the document. */
export type ClosedTarget = "session" | "document";
/** A thread the roster has read against the live inventory; a saved target is only a request. */
export interface TargetRead {
  targetClosed?: ClosedTarget;
}
/** The inventory is the authority: closed only when a read inventory proves the target gone. */
export function targetClosure(
  target: DocumentRequest | null,
  inventory: TargetInventory,
): ClosedTarget | undefined {
  const resolution = resolveCallTarget({ needs: "document" }, target, inventory);
  if (!target || resolution.kind !== "choose") return undefined;
  return resolution.reason === "session-gone"
    ? "session"
    : resolution.reason === "document-closed"
      ? "document"
      : undefined;
}
/**
 * A thread read against the live inventory: whether its target is closed, and a row label that
 * says so in words (the exact target stays one hover away). A live document shows its open title.
 */
export function readThreadTarget<T extends HarnessThreadSummary>(
  thread: T,
  inventory: TargetInventory,
): T & TargetRead {
  const target = thread.head.defaultTarget;
  if (!target || inventory.kind !== "ready") return thread;
  const targetClosed = targetClosure(target, inventory);
  const resolution = resolveCallTarget({ needs: "document" }, target, inventory);
  const ref =
    resolution.kind === "resolved" && resolution.target.kind === "document"
      ? resolution.target.ref
      : null;
  const sessionDocuments = ref ? inventory.sessions[ref.session] : undefined;
  const live =
    sessionDocuments?.kind === "ready"
      ? sessionDocuments.values.find((document) => document.openId === ref!.openId)
      : undefined;
  const closed = targetClosed
    ? [thread.head.displayLabel, targetClosed === "session" ? "Closed session" : "Closed document"]
        .filter(Boolean)
        .join(" · ")
    : undefined;
  const label = live?.address?.split(/[\\/]/).at(-1) ?? closed;
  return {
    ...thread,
    targetClosed,
    head: label ? { ...thread.head, displayLabel: label } : thread.head,
  };
}
/** The one Target-filter option every closed target collapses into. */
const CLOSED_TARGETS = "closed";
export const targetFacet = (thread: HarnessThreadSummary & TargetRead) =>
  thread.targetClosed ? CLOSED_TARGETS : navigationTargetKey(thread.head.defaultTarget);
/** Live targets one by one; closed ones are never listed, only the single "Closed" option. */
export function targetFacets(threads: (HarnessThreadSummary & TargetRead)[]) {
  const live = new Map<string, string>();
  for (const thread of threads)
    if (!thread.targetClosed) live.set(targetFacet(thread), targetLabel(thread));
  return [
    ...[...live].map(([key, label]) => ({ key, label })),
    ...(threads.some((thread) => thread.targetClosed)
      ? [{ key: CLOSED_TARGETS, label: "Closed" }]
      : []),
  ];
}
export const threadOrder = (thread: HarnessThreadSummary) =>
  thread.lifecycle.order ?? -Date.parse(thread.lifecycle.reopenedAt ?? thread.createdAt);
export const isUnread = (thread: HarnessThreadSummary) =>
  thread.lifecycle.explicitUnread || thread.activity.lastSeq > thread.lifecycle.readSeq;
export function wokeFromSnooze(
  previous: HarnessThreadSummary | undefined,
  current: HarnessThreadSummary,
  now: number,
): boolean {
  const until = previous?.lifecycle.snoozedUntil ?? current.lifecycle.snoozedUntil;
  if (!until || current.lifecycle.status === "archived") return false;
  return (
    Date.parse(until) <= now ||
    (current.lifecycle.snoozedUntil === null &&
      current.activity.lastSeq > (previous?.lifecycle.snoozedSeq ?? current.lifecycle.snoozedSeq))
  );
}
export const shelfOf = (thread: HarnessThreadSummary, now = Date.now()): ThreadShelf =>
  thread.lifecycle.status === "archived"
    ? "archived"
    : thread.lifecycle.snoozedUntil && Date.parse(thread.lifecycle.snoozedUntil) > now
      ? "snoozed"
      : thread.lifecycle.status === "settled"
        ? "settled"
        : thread.lifecycle.pinned
          ? "pinned"
          : "active";

export function targetLabel(thread: { head: ThreadHead }): string {
  const target = thread.head.defaultTarget;
  if (!target) return "Untargeted";
  if (thread.head.displayLabel) return thread.head.displayLabel;
  if (target.kind === "named") return target.address.split(/[\\/]/).at(-1) || target.address;
  return `Document in ${target.ref.session}`;
}

/** Title, target, provider/model, and immutable identity share one search surface. */
export const threadSearchText = (
  thread: Pick<HarnessThreadSummary, "id" | "title" | "providerName" | "modelId" | "head">,
) =>
  [
    thread.title,
    thread.providerName,
    thread.modelId,
    targetLabel(thread),
    targetKey(thread.head.defaultTarget),
    thread.id,
  ]
    .filter(Boolean)
    .join(" ");
/** The activity that asks for something; a resting thread has none (the sidebar says nothing). */
export function activityWord(thread: HarnessThreadSummary): string | undefined {
  if (thread.activity.pending) return `${thread.activity.pending} waiting for you`;
  if (thread.activity.state === "waiting") return "Waiting for you";
  if (thread.activity.state === "running") return "Working";
  if (thread.activity.state === "failed") return "Failed";
  return undefined;
}
/** What a thread is doing, as the roster's state filter asks it. */
export const THREAD_STATES = ["working", "waiting", "failed", "idle"] as const;
export type ThreadActivity = (typeof THREAD_STATES)[number];
function threadActivity(thread: HarnessThreadSummary): ThreadActivity {
  if (thread.activity.pending || thread.activity.state === "waiting") return "waiting";
  if (thread.activity.state === "running") return "working";
  if (thread.activity.state === "failed") return "failed";
  return "idle";
}
/** Target, provider and state narrow the roster ("*" is all); `unread` composes with all three. */
export function visibleThreads<T extends HarnessThreadSummary & TargetRead>(
  threads: T[],
  options: {
    query: string;
    filter: ThreadFilter;
    target: string;
    provider: string;
    state: ThreadActivity | "*";
    unread: boolean;
    now?: number;
  },
) {
  const query = options.query.trim().toLowerCase();
  return threads
    .filter((thread) => {
      if (options.target !== "*" && targetFacet(thread) !== options.target) return false;
      if (options.provider !== "*" && thread.providerId !== options.provider) return false;
      if (options.state !== "*" && threadActivity(thread) !== options.state) return false;
      if (options.unread && !isUnread(thread)) return false;
      if (options.filter === "inbox") {
        if (!inThreadInbox(thread, options.now)) return false;
      } else if (
        options.filter === "archived"
          ? thread.lifecycle.status !== "archived"
          : thread.lifecycle.status === "archived"
      )
        return false;
      return threadSearchText(thread).toLowerCase().includes(query);
    })
    .sort((a, b) => {
      const aShelf = shelfOf(a, options.now),
        bShelf = shelfOf(b, options.now);
      const anchor = (thread: HarnessThreadSummary, shelf: ThreadShelf) =>
        shelf === "snoozed"
          ? thread.lifecycle.snoozedUntil!
          : shelf === "settled"
            ? (thread.lifecycle.settledAt ?? thread.updatedAt)
            : (thread.lifecycle.reopenedAt ?? thread.createdAt);
      return aShelf === "snoozed" && bShelf === "snoozed"
        ? anchor(a, aShelf).localeCompare(anchor(b, bShelf))
        : aShelf === "settled" || aShelf === "archived"
          ? anchor(b, bShelf).localeCompare(anchor(a, aShelf))
          : threadOrder(a) - threadOrder(b) || a.id.localeCompare(b.id);
    });
}

const isBusy = (thread: HarnessThreadSummary) =>
  thread.activity.state === "running" || thread.activity.pending > 0;
const isAsking = (thread: HarnessThreadSummary) => thread.activity.pending > 0;

/** One lifecycle verb over a selection of one or many threads: its word, the threads it would
 *  change (`targets`), and, when none can take it, why (`refusal`). */
export interface ThreadAction<T extends HarnessThreadSummary = HarnessThreadSummary> {
  /** `snooze` is also its undo: "Wake now" when every selected thread is snoozed. */
  id: "pin" | "settle" | "snooze" | "unread" | "archive" | "new-target";
  label: string;
  refusal?: string;
  targets: T[];
  /** The change for one target; snooze takes its wake time from the preset picked. */
  change?: (thread: T) => UpdateThreadRequest;
  /** Many threads, some skipped: "2 of 3". */
  note?: string;
}

/**
 * The verbs that work on a selection of any size. One thread is the selection of one, so the
 * row menu and the many-thread menu share this rule. A verb is on when at least one selected
 * thread can take it (and applies to those); it refuses, with a reason, only when none can.
 */
export function threadActions<T extends HarnessThreadSummary & TargetRead>(
  threads: T[],
): ThreadAction<T>[] {
  const many = threads.length > 1;
  const verb = (
    id: ThreadAction["id"],
    label: string,
    targets: T[],
    why: string,
    change?: ThreadAction<T>["change"],
  ): ThreadAction<T> => ({
    id,
    label,
    targets,
    change,
    refusal: targets.length ? undefined : many ? `none of ${threads.length} can: ${why}` : why,
    note:
      many && targets.length && targets.length < threads.length
        ? `${targets.length} of ${threads.length}`
        : undefined,
  });
  const where = (keep: (thread: T) => boolean) => threads.filter(keep);
  const allPinned = threads.every((thread) => thread.lifecycle.pinned);
  const allSettled = threads.every((thread) => thread.lifecycle.status === "settled");
  const allSnoozed = threads.every((thread) => thread.lifecycle.snoozedUntil);
  const allArchived = threads.every((thread) => thread.lifecycle.status === "archived");
  const anyRead = threads.some((thread) => !isUnread(thread));
  // A closed target is never a place to start work: only a live one can seed a new thread.
  const closedWhy = many
    ? "its target is closed"
    : threads[0]?.targetClosed === "session"
      ? "Its session is closed"
      : threads[0]?.targetClosed === "document"
        ? "Its document is closed"
        : "it has no target";
  return [
    allPinned
      ? verb("pin", "Unpin", threads, "", () => ({ pinned: false }))
      : verb(
          "pin",
          "Pin",
          where((thread) => !thread.lifecycle.pinned),
          "",
          () => ({
            pinned: true,
          }),
        ),
    allSettled
      ? verb("settle", "Reopen", threads, "", () => ({ status: "active" }))
      : verb(
          "settle",
          "Settle",
          where((thread) => thread.lifecycle.status !== "settled" && !isBusy(thread)),
          "finish the work and answer its asks first",
          () => ({ status: "settled" }),
        ),
    allSnoozed
      ? verb("snooze", "Wake now", threads, "", () => ({ snoozedUntil: null }))
      : verb(
          "snooze",
          "Snooze",
          where((thread) => !isAsking(thread)),
          "answer its asks first",
        ),
    anyRead
      ? verb(
          "unread",
          "Mark unread",
          where((thread) => !isUnread(thread)),
          "",
          () => ({ explicitUnread: true }),
        )
      : verb("unread", "Mark read", threads, "", (thread) => ({
          readSeq: thread.lastSeq,
          explicitUnread: false,
        })),
    allArchived
      ? verb("archive", "Restore", threads, "", () => ({ status: "active" }))
      : verb(
          "archive",
          "Archive",
          where((thread) => thread.lifecycle.status !== "archived" && !isBusy(thread)),
          "finish the work and answer its asks first",
          () => ({ status: "archived" }),
        ),
    verb(
      "new-target",
      "New thread on this target",
      where((thread) => thread.head.defaultTarget !== null && !thread.targetClosed),
      closedWhy,
    ),
  ];
}

/** Why a verb that works on one thread is off while several are selected; absent for one. */
export const oneThreadRefusal = (verb: string, selected: number): string | undefined =>
  selected > 1 ? `${verb} works on one thread; ${selected} are selected` : undefined;

/** Fixture-only navigation beside the existing demo transcript; never a product store. */
export function demoThreads(body: HarnessThreadBody): HarnessThreadSummary[] {
  const target = {
    kind: "named" as const,
    session: "pe.app-26",
    address: address("C:/Review/Operations Demo.rvt"),
  };
  const at = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString();
  const base = {
    ...body,
    head: {
      ...emptyThreadHead,
      hostNow: at(0),
      grantView: null,
      defaultTarget: target,
      revision: 3,
    },
    lifecycle: emptyThreadLifecycle(),
    activity: { state: "idle" as const, pending: 0, lastSeq: 2, message: null },
    lastSeq: 2,
    providerName: "Claude",
    modelId: "Sonnet 4.6",
  };
  return [
    {
      ...base,
      id: body.id,
      title: body.title || "Level 2 coordination review",
      updatedAt: at(0),
      lifecycle: { ...base.lifecycle, pinned: true },
      activity: { ...base.activity, state: "waiting", pending: 1 },
    },
    {
      ...base,
      id: "fixture-running",
      title: "Trace the supply air path",
      updatedAt: at(4),
      providerId: "codex",
      providerName: "Codex",
      modelId: "GPT-5.4",
      activity: { ...base.activity, state: "running" },
    },
    {
      ...base,
      id: "fixture-local",
      title: "Draft the BIM handoff notes",
      updatedAt: at(12),
      head: { ...emptyThreadHead, hostNow: at(0), grantView: null },
      lifecycle: { ...base.lifecycle, readSeq: 2 },
    },
    {
      ...base,
      id: "fixture-family",
      title: "Check AHU type parameters",
      updatedAt: at(30),
      head: {
        ...emptyThreadHead,
        hostNow: at(0),
        grantView: null,
        defaultTarget: { ...target, address: address("C:/Families/Air Handling Unit.rfa") },
        revision: 1,
      },
      activity: {
        ...base.activity,
        state: "failed",
        message: "Parameter capture refused: document closed",
      },
    },
    {
      ...base,
      id: "fixture-snoozed",
      title: "Review the return air schedule",
      updatedAt: at(55),
      lifecycle: {
        ...base.lifecycle,
        snoozedUntil: new Date(Date.now() + 3_600_000).toISOString(),
        readSeq: 2,
      },
    },
    {
      ...base,
      id: "fixture-settled",
      title: "Normalize equipment names",
      updatedAt: at(120),
      lifecycle: { ...base.lifecycle, status: "settled", readSeq: 2 },
    },
    {
      ...base,
      id: "fixture-archived",
      title: "Original schedule exploration",
      updatedAt: at(600),
      lifecycle: { ...base.lifecycle, status: "archived", readSeq: 2 },
    },
    {
      ...base,
      id: "fixture-ended",
      title: "Resize the ductwork on Level 1",
      updatedAt: at(75),
      head: {
        ...emptyThreadHead,
        hostNow: at(0),
        grantView: null,
        defaultTarget: { ...target, session: "pe.app-25" },
        revision: 2,
      },
      lifecycle: { ...base.lifecycle, readSeq: 2 },
    },
  ];
}
