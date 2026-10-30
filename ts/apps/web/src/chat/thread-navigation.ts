import {
  emptyThreadLifecycle,
  resolveCallTarget,
  targetKey,
  targetsLabel,
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
export const THREAD_SHELVES: ThreadShelf[] = ["pinned", "active", "snoozed", "settled", "archived"];
/** Attention observes work in flight and unread answers; pinning alone is not work. */
export function inAttention(thread: HarnessThreadSummary, now = Date.now()): boolean {
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
  if (!target) return undefined;
  const resolution = resolveCallTarget({ needs: "document" }, [target], inventory);
  if (resolution.kind !== "choose") return undefined;
  return resolution.reason === "session-gone"
    ? "session"
    : resolution.reason === "document-closed"
      ? "document"
      : undefined;
}
/** A thread read against the live inventory: closed when a read inventory proves a target gone. */
export function readThreadTarget<T extends HarnessThreadSummary>(
  thread: T,
  inventory: TargetInventory,
): T & TargetRead {
  if (inventory.kind !== "ready") return thread;
  const targetClosed = thread.head.targets
    .map((target) => targetClosure(target.request, inventory))
    .find(Boolean);
  return targetClosed ? { ...thread, targetClosed } : thread;
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

/** The thread's targets in one line: the one document's name, or a count when several. */
export function targetLabel(thread: { head: ThreadHead }): string {
  const { targets } = thread.head;
  if (targets.length > 1) return targetsLabel(targets)!;
  const only = targets[0];
  if (!only) return "Untargeted";
  if (only.label) return only.label;
  const target = only.request;
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
    ...thread.head.targets.map((target) => targetKey(target.request)),
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
export function threadActivity(thread: HarnessThreadSummary): ThreadActivity {
  if (thread.activity.pending || thread.activity.state === "waiting") return "waiting";
  if (thread.activity.state === "running") return "working";
  if (thread.activity.state === "failed") return "failed";
  return "idle";
}
/** Shelf order remains domain-owned; search, facets and selection belong to useList. */
export function compareThreads(a: HarnessThreadSummary, b: HarnessThreadSummary, now = Date.now()) {
  const aShelf = shelfOf(a, now),
    bShelf = shelfOf(b, now);
  if (aShelf !== bShelf) return THREAD_SHELVES.indexOf(aShelf) - THREAD_SHELVES.indexOf(bShelf);
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
      where((thread) => soleRequest(thread.head) !== null && !thread.targetClosed),
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
    head: { targets: [{ request: target, admission: null }], revision: 3 },
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
      // Two connected tools, each on its own demo seed, so the tools bar has tabs to press.
      tabs: [
        {
          id: "demo-tab-ducts",
          route: "ducts",
          link: "/ducts?fixture=scene&system=Office%20retained%20page",
          at: at(1),
        },
        { id: "demo-tab-families", route: "families", link: "/families?fixture=apply", at: at(2) },
      ],
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
      head: emptyThreadHead,
      lifecycle: { ...base.lifecycle, readSeq: 2 },
    },
    {
      ...base,
      id: "fixture-family",
      title: "Check AHU type parameters",
      updatedAt: at(30),
      head: {
        targets: [
          {
            request: { ...target, address: address("C:/Families/Air Handling Unit.rfa") },
            admission: null,
          },
        ],
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
        targets: [{ request: { ...target, session: "pe.app-25" }, admission: null }],
        revision: 2,
      },
      lifecycle: { ...base.lifecycle, readSeq: 2 },
    },
  ];
}

/** The thread's one document request; null when it targets none or several (ADR 0021). */
export const soleRequest = (head: ThreadHead): DocumentRequest | null =>
  head.targets.length === 1 ? head.targets[0]!.request : null;
