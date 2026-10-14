/**
 * The open-work ledger: one row model, three presentations (Home's column, the Ctrl+Shift+K
 * overlay, the tray Inbox). Rows come from the host's own stores; a notice is a row arriving.
 * Waits and working lead every presentation and never fold (owner, 2026-10-13).
 */
import type {
  ActionReceipt,
  CaptureReceipt,
  HarnessEvent,
  HarnessThreadSummary,
  NavigationWork,
} from "@pe/agent-contracts";
import { HOST_RESTARTED } from "@pe/agent-contracts/chat-state";

const LEDGER_GROUPS = [
  "waits",
  "working",
  "interrupted",
  "failed",
  "unread",
  "works",
  "recent",
] as const;
export type LedgerGroup = (typeof LEDGER_GROUPS)[number];
export const GROUP_NAME: Record<LedgerGroup, string> = {
  waits: "waits on you",
  working: "working",
  interrupted: "interrupted",
  failed: "failed",
  unread: "unread",
  works: "saved work",
  recent: "recent",
};
/** Groups no presentation may fold. */
const LEADING: readonly LedgerGroup[] = ["waits", "working"];
/** A host-restart death leaves the ledger after this long; Pea's thread list still holds it. */
const INTERRUPTED_FOR_MS = 24 * 3_600_000;

export interface LedgerRow {
  key: string;
  group: LedgerGroup;
  /** The one word that says what the row is: asks, approve, unknown, running, failed… */
  verb: string;
  what: string;
  where: string;
  /** The row's own sentence: the ask, the error, the outcome. */
  says: string | null;
  at: string | null;
  /** The resource address; null is an explicit refusal to invent one. */
  url: string | null;
  refusal?: string;
  /** A thread whose turn the host's restart cut off: Resume re-sends that turn. */
  resume?: string;
}

export interface LedgerSources {
  threads: readonly HarnessThreadSummary[];
  /** The open ask of each waiting thread, in its own words. */
  asks: ReadonlyMap<string, { verb: string; says: string }>;
  receipts: readonly ActionReceipt[];
  works: readonly NavigationWork[];
  /** Machine attention lines (update waits, a Revit dialog). */
  attention: readonly string[];
  captures: readonly CaptureReceipt[];
}

/** A waiting thread's open ask, in its own words: the question, or the tool asking permission. */
export function openAsk(events: readonly HarnessEvent[]): { verb: string; says: string } | null {
  const resolved = new Set(
    events.flatMap((e) =>
      e.kind === "permission_resolved" || e.kind === "question_resolved" ? [e.requestId] : [],
    ),
  );
  const open = [...events]
    .reverse()
    .find(
      (e) =>
        (e.kind === "question_request" || e.kind === "permission_request") &&
        !resolved.has(e.requestId),
    );
  if (open?.kind === "question_request") return { verb: "asks", says: open.message };
  if (open?.kind === "permission_request")
    return { verb: "approve", says: open.toolCall.title ?? "a tool call" };
  return null;
}

const NO_ADDRESS = "No address yet: this receipt has no page";

function threadRow(thread: HarnessThreadSummary, sources: LedgerSources, now: number) {
  const { state, pending, message } = thread.activity;
  const base = {
    key: `thread:${thread.id}`,
    what: thread.title,
    where: thread.providerName,
    at: thread.updatedAt,
    url: `/pea?thread=${thread.id}`,
  };
  if (state === "waiting" || pending > 0) {
    const ask = sources.asks.get(thread.id);
    return { ...base, group: "waits", verb: ask?.verb ?? "asks", says: ask?.says ?? message };
  }
  if (state === "running") return { ...base, group: "working", verb: "running", says: null };
  if (state === "failed" && message === HOST_RESTARTED)
    return now - Date.parse(thread.updatedAt) > INTERRUPTED_FOR_MS
      ? null
      : {
          ...base,
          group: "interrupted",
          verb: "interrupted",
          says: "The host restarted during this turn.",
          resume: thread.id,
        };
  if (state === "failed") return { ...base, group: "failed", verb: "failed", says: message };
  const unread = thread.lifecycle.explicitUnread || thread.lifecycle.readSeq < thread.lastSeq;
  return unread && thread.lastSeq > 0
    ? { ...base, group: "unread", verb: "done", says: null }
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

function receiptRow(receipt: ActionReceipt): LedgerRow | null {
  const group: LedgerGroup | null =
    receipt.state === "unknown" || receipt.state === "incomplete"
      ? "waits"
      : receipt.state === "failed"
        ? "failed"
        : receipt.state === "running"
          ? "working"
          : receipt.state === "succeeded"
            ? "recent"
            : null;
  if (!group) return null;
  return {
    key: `action:${receipt.id}`,
    group,
    verb: receipt.state === "succeeded" ? "done" : receipt.state,
    what: receipt.key,
    where: `${receipt.kind} · ${callerWord(receipt.caller)}`,
    says:
      "error" in receipt
        ? receipt.error
        : group === "waits"
          ? "The outcome is not known. Check Revit before running it again."
          : null,
    at: receipt.startedAt,
    url: null,
    refusal: NO_ADDRESS,
  };
}

/** Every row, group order first (waits and working lead), newest first inside a group. */
export function ledgerRows(sources: LedgerSources, now: number): LedgerRow[] {
  const rows: LedgerRow[] = [
    ...sources.attention.map((line) => ({
      key: `machine:${line}`,
      group: "waits" as const,
      verb: "machine",
      what: line,
      where: "this computer",
      says: null,
      at: null,
      url: "/machine",
    })),
    ...sources.threads
      .filter((thread) => thread.lifecycle.status === "active")
      .flatMap((thread) => (threadRow(thread, sources, now) as LedgerRow | null) ?? []),
    ...sources.receipts.flatMap((receipt) => receiptRow(receipt) ?? []),
    ...sources.works.map((work) => ({
      key: `work:${work.id}`,
      group: "works" as const,
      verb: work.state === "ready" ? "saved" : work.state,
      what: work.label,
      where: work.context,
      says: work.reason,
      at: null,
      url: work.url,
      refusal: work.url ? undefined : (work.reason ?? "No resumable destination"),
    })),
    ...sources.captures.slice(0, 12).map((capture) => ({
      key: `capture:${capture.id}`,
      group: "recent" as const,
      verb: "captured",
      what: capture.view?.name ?? "a view",
      where: [capture.document?.title, capture.origin].filter(Boolean).join(" · "),
      says: null,
      at: capture.at,
      url: `/captures?sha=${capture.sha}`,
    })),
  ];
  return rows.sort(
    (a, b) =>
      LEDGER_GROUPS.indexOf(a.group) - LEDGER_GROUPS.indexOf(b.group) ||
      (b.at ?? "").localeCompare(a.at ?? ""),
  );
}

export interface LedgerPresentation {
  id: "home" | "overlay" | "tray";
  label: string;
  /** Groups shown, in order. */
  groups: readonly LedgerGroup[];
  /** Rows a foldable group shows before one "n more" row; per-group overrides (0 = a count only). */
  cap: number;
  caps?: Partial<Record<LedgerGroup, number>>;
  /** The group counter strip on top. */
  counters: boolean;
  /** Tools, Works and threads join the rows while a query is typed. */
  destinations: boolean;
  /** Draw the row's sentence under it. */
  says: boolean;
}

const OPEN_GROUPS: readonly LedgerGroup[] = ["waits", "working", "interrupted", "failed", "unread"];
export const LEDGER_PRESENTATIONS: Record<LedgerPresentation["id"], LedgerPresentation> = {
  home: {
    id: "home",
    label: "Open work",
    groups: LEDGER_GROUPS,
    cap: 5,
    counters: false,
    destinations: false,
    says: true,
  },
  overlay: {
    id: "overlay",
    label: "Find open work, tools, Works and Pea threads",
    groups: OPEN_GROUPS,
    cap: 3,
    caps: { unread: 0 },
    counters: false,
    destinations: true,
    says: false,
  },
  tray: {
    id: "tray",
    label: "Inbox",
    groups: OPEN_GROUPS,
    cap: 30,
    caps: { unread: 0 },
    counters: true,
    destinations: false,
    says: true,
  },
};

export type LedgerItem =
  | { kind: "row"; key: string; row: LedgerRow }
  /** A folded group's tail: `count` rows hidden; picking it opens the group in place. */
  | { kind: "more"; key: string; group: LedgerGroup; count: number }
  /** A leading group with no rows still shows, so "nothing waits" is said, never implied. */
  | { kind: "empty"; key: string; group: LedgerGroup };

/** The rows a presentation draws, folded: waits and working never fold; `open` groups unfold. */
export function presentLedger(
  rows: readonly LedgerRow[],
  presentation: LedgerPresentation,
  open: ReadonlySet<LedgerGroup>,
): LedgerItem[] {
  return presentation.groups.flatMap((group) => {
    const members = rows.filter((row) => row.group === group);
    if (!members.length && LEADING.includes(group))
      return [{ kind: "empty" as const, key: `empty:${group}`, group }];
    const cap =
      LEADING.includes(group) || open.has(group)
        ? members.length
        : (presentation.caps?.[group] ?? presentation.cap);
    const shown: LedgerItem[] = members
      .slice(0, cap)
      .map((row) => ({ kind: "row", key: row.key, row }));
    return members.length > cap
      ? [...shown, { kind: "more", key: `more:${group}`, group, count: members.length - cap }]
      : shown;
  });
}

/** The counter strip's groups: waits and working first, then the presentation's own order. */
export function counterGroups(presentation: LedgerPresentation): LedgerGroup[] {
  return [...LEADING, ...presentation.groups.filter((group) => !LEADING.includes(group))];
}
