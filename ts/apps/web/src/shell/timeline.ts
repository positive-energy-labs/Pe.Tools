import {
  invocationOutcome,
  type ActionStatus,
  type VerbDecl,
  type InvocationOutcome,
} from "@pe/agent-contracts";
import {
  receiptBarrier,
  type WorkJournal,
  type TimelineBarrier,
  type TimelineEntry,
} from "@pe/runtime/work-journal";
export { receiptBarrier } from "@pe/runtime/work-journal";
export type { TimelineBarrier, TimelineEntry } from "@pe/runtime/work-journal";

// Presentation retention only; accepted Work and invocations replay from durable host history.
export const TIMELINE_LIMIT = 200;

/** One instance per mounted route. Append order, rather than wall-clock order, is authoritative. */
export function createRouteTimeline() {
  let entries: TimelineEntry[] = [];
  let revision = 0;
  const listeners = new Set<(entry: TimelineEntry) => void>();
  return {
    version: () => revision,
    append(entry: TimelineEntry): void {
      revision++;
      const recorded = structuredClone(entry);
      // Host receipts are current invocation state, identical on live delivery and replay.
      const prior =
        recorded.kind === "receipt" && recorded.outcome?.id
          ? entries.filter(
              (entry) => entry.kind !== "receipt" || entry.outcome?.id !== recorded.outcome?.id,
            )
          : entries;
      entries = [...prior, recorded].slice(-TIMELINE_LIMIT);
      for (const listener of listeners) listener(structuredClone(recorded));
    },
    outcome(press: string, outcome: InvocationOutcome): void {
      const index = entries.findIndex(
        (entry) => entry.kind === "invocation" && entry.press === press,
      );
      if (index < 0) return;
      revision++;
      const updated = { ...entries[index]!, outcome: structuredClone(outcome) };
      entries = entries.map((entry, at) => (at === index ? updated : entry));
      for (const listener of listeners) listener(structuredClone(updated));
    },
    read: (): readonly TimelineEntry[] => structuredClone(entries),
    subscribe(listener: (entry: TimelineEntry) => void): () => void {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

export type RouteTimeline = ReturnType<typeof createRouteTimeline>;

/** Clock time is local to the reader; elapsed time comes from the same press's invocation. */
export function activityTime(at: TimelineEntry["at"], startedAt?: TimelineEntry["at"]) {
  const date = new Date(at);
  if (!Number.isFinite(date.getTime())) return "Time unavailable";
  const clock = date.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  const elapsed = startedAt == null ? NaN : date.getTime() - new Date(startedAt).getTime();
  return Number.isFinite(elapsed) && elapsed >= 0
    ? `${clock} · ${(elapsed / 1000).toFixed(1)} s`
    : clock;
}

/** Declaration identity is retained at invocation start; presentation always derives here. */
export type TimelineVerbs = Readonly<
  Record<string, Partial<Pick<VerbDecl, "kind" | "does">> & { label: string; entry?: string }>
>;
type Journal = ReturnType<WorkJournal["read"]>;
export interface TimelineRow {
  key: string;
  at: TimelineEntry["at"];
  kind: "press" | "receipt" | "consent" | "journal" | "feed" | "checkpoint";
  verb: string;
  entry: TimelineEntry;
  outcome?: InvocationOutcome;
  consentUntil?: string | null;
  move?: Journal["moves"][number];
  step?: Journal["undo"][number];
  barrier?: TimelineBarrier;
  startedAt?: TimelineEntry["at"];
}

/** Latest receipts replace starts and earlier states, never the journal's retained undo barriers. */
export function projectTimeline(
  entries: readonly TimelineEntry[],
  verbs: TimelineVerbs,
  journal?: Journal | null,
  now = Date.now(),
): TimelineRow[] {
  const latest = new Map<string, TimelineEntry>();
  entries.forEach((entry, index) => {
    const receipt = (entry.basis as { receipt?: ActionStatus } | undefined)?.receipt;
    const id = receipt?.id ?? entry.receiptId ?? entry.outcome?.receiptId ?? entry.outcome?.id;
    latest.set(
      entry.kind === "receipt" && id
        ? `receipt:${id}`
        : entry.kind === "invocation" && entry.press
          ? `press:${entry.press}`
          : `entry:${index}`,
      entry,
    );
  });
  const current = [...latest.values()];
  const moves = journal?.moves ?? [];
  const rows = current.flatMap((entry, index): TimelineRow[] => {
    const receipt = (entry.basis as { receipt?: ActionStatus } | undefined)?.receipt;
    const id = receipt?.id ?? entry.receiptId ?? entry.outcome?.receiptId;
    if (
      entry.kind === "invocation" &&
      (moves.some((move) => move.press === entry.press) ||
        current.some(
          (other) =>
            other.kind === "receipt" &&
            ((entry.press != null &&
              (other.press === entry.press || other.receiptId === entry.press)) ||
              (entry.outcome?.receiptId != null &&
                other.outcome?.receiptId === entry.outcome.receiptId)),
        ))
    )
      return [];
    // The registry already projects moves as checkpoints. Use the journal itself when supplied.
    if (journal && entry.kind === "checkpoint" && moves.some((move) => move.press === entry.press))
      return [];
    const command = receipt?.key;
    const declaration = command
      ? (verbs[command] ??
        Object.values(verbs).find((verb) => (verb.does ?? verb.entry) === command))
      : entry.verb
        ? verbs[entry.verb]
        : undefined;
    const outcome = receipt?.state ? invocationOutcome(receipt) : entry.outcome;
    const window = outcome?.consentWindow;
    const open =
      !!window &&
      ["queued", "running"].includes(outcome!.state) &&
      (!window.deadline || new Date(window.deadline).getTime() > now);
    return [
      {
        key: id ? `receipt:${id}` : `event:${index}`,
        at: entry.at,
        kind: open ? "consent" : entry.kind === "invocation" ? "press" : entry.kind,
        verb: declaration?.label ?? command ?? entry.verb ?? entry.kind,
        entry,
        outcome,
        ...(open && { consentUntil: window!.deadline ?? null }),
        barrier: receiptBarrier({ ...entry, outcome }) ?? undefined,
        startedAt:
          entry.kind === "receipt" && !receipt
            ? entries.find((start) => start.kind === "invocation" && start.press === entry.press)
                ?.at
            : undefined,
      },
    ];
  });
  for (const move of moves) {
    const step = [...(journal?.undo ?? []), ...(journal?.redo ?? [])].find(
      (step) => step.press === move.press,
    );
    rows.push({
      key: `work:${move.revision}:${move.kind}`,
      kind: "journal",
      at: move.at,
      verb: move.label,
      move,
      step,
      barrier: step?.barrier,
      entry: { kind: "checkpoint", at: move.at, press: move.press, basis: move },
    });
  }
  return rows.sort((a, b) => Number(new Date(a.at)) - Number(new Date(b.at)));
}
