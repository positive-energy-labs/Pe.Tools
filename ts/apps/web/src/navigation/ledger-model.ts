/**
 * The open-work ledger: one row model, three presentations (Home's column, the Ctrl+Shift+K
 * overlay, the tray Activity). Rows come from the host's own stores; a notice is a row arriving.
 * Waits and working lead every presentation and never fold (owner, 2026-10-13).
 */
import type {
  ActionReceipt,
  HarnessEvent,
  HarnessThreadSummary,
  NavigationWork,
} from "@pe/agent-contracts";
import { HOST_RESTARTED } from "@pe/agent-contracts/chat-state";
import { routeAddress } from "@pe/agent-contracts";
import { summarizeFailure } from "@pe/host-contracts/failure-summary";

/** In the order the eye takes them; waits and working lead and never fold. */
export const LEDGER_GROUPS = ["waits", "working", "interrupted", "failed", "unread"] as const;
export type LedgerGroup = (typeof LEDGER_GROUPS)[number];
export const GROUP_NAME: Record<LedgerGroup, string> = {
  waits: "waits on you",
  working: "working",
  interrupted: "interrupted",
  failed: "failed",
  unread: "unread",
};
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
  /** The raw failure text the one-line `says` folds; the row offers it to copy. */
  detail?: string;
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

function threadRow(
  thread: HarnessThreadSummary,
  asks: LedgerSources["asks"],
  now: number,
): LedgerRow | null {
  const { state, pending, message } = thread.activity;
  const row = (group: LedgerGroup, verb: string, says: string | null): LedgerRow => ({
    key: `thread:${thread.id}`,
    group,
    verb,
    what: thread.title,
    where: thread.providerName,
    says,
    at: thread.updatedAt,
    url: routeAddress("pea").link({}, { thread: thread.id }),
  });
  if (state === "waiting" || pending > 0) {
    const ask = asks.get(thread.id);
    return row("waits", ask?.verb ?? "asks", ask?.says ?? message);
  }
  if (state === "running") return row("working", "running", null);
  if (state === "failed" && message === HOST_RESTARTED)
    return now - Date.parse(thread.updatedAt) > INTERRUPTED_FOR_MS
      ? null
      : {
          ...row("interrupted", "interrupted", "The host restarted during this turn."),
          resume: thread.id,
        };
  if (state === "failed") {
    const failure = summarizeFailure(message ?? "The turn failed.");
    return { ...row("failed", "failed", failure.summary), detail: failure.detail ?? undefined };
  }
  const unread = thread.lifecycle.explicitUnread || thread.lifecycle.readSeq < thread.lastSeq;
  return unread && thread.lastSeq > 0 ? row("unread", "done", null) : null;
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

const RECEIPT_GROUP: Partial<Record<ActionReceipt["state"], LedgerGroup>> = {
  unknown: "waits",
  incomplete: "waits",
  running: "working",
  failed: "failed",
};

function receiptRow(receipt: ActionReceipt): LedgerRow | null {
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
    verb: receipt.state,
    what: receipt.key,
    where: `${receipt.kind} · ${callerWord(receipt.caller)}`,
    says: failure.summary,
    at: receipt.startedAt,
    // The failure's door is the row's address; a receipt itself has no page yet.
    url: failure.door
      ? `${routeAddress("settings").link({ section: failure.door.section })}${failure.door.hash ? `#${failure.door.hash}` : ""}`
      : null,
    refusal: failure.door ? undefined : "No address yet: this receipt has no page",
    detail: failure.detail ?? undefined,
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
      url: routeAddress("settings").link(),
    })),
    ...sources.threads
      .filter((thread) => thread.lifecycle.status === "active")
      .flatMap((thread) => threadRow(thread, sources.asks, now) ?? []),
    ...sources.receipts.flatMap((receipt) => receiptRow(receipt) ?? []),
    // A Work enters only when Pea proposed on it; Home's directory already lists every saved Work.
    ...sources.works
      .filter((work) => work.proposals > 0)
      .map((work) => ({
        key: `work:${work.id}`,
        group: "waits" as const,
        verb: "review",
        what: work.label,
        where: work.context,
        says: `${work.proposals} Pea proposal${work.proposals === 1 ? "" : "s"} to review`,
        at: null,
        url: work.url,
        refusal: work.url ? undefined : (work.reason ?? "No resumable destination"),
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
  /** The group counter strip on top. */
  counters: boolean;
  /** Tools, Works and threads join the rows while a query is typed. */
  destinations: boolean;
  /** Draw the row's sentence under it. */
  says: boolean;
}

export const LEDGER_PRESENTATIONS: Record<LedgerPresentation["id"], LedgerPresentation> = {
  home: {
    id: "home",
    label: "Activity",
    counters: false,
    destinations: false,
    says: true,
  },
  overlay: {
    id: "overlay",
    label: "Find open work, tools, Works and Pea threads",
    counters: false,
    destinations: true,
    says: false,
  },
  tray: {
    id: "tray",
    label: "Activity",
    counters: true,
    destinations: false,
    says: true,
  },
};

export type LedgerItem =
  | { kind: "row"; key: string; row: LedgerRow }
  /** An explicit empty leading group; it never stands in for hidden rows. */
  | { kind: "note"; key: string; group: LedgerGroup; count: 0; text: string };
