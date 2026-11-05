import type { InvocationOutcome, VerbDecl } from "@pe/agent-contracts";
import { receiptBarrier, type TimelineBarrier, type TimelineEntry } from "@pe/runtime/work-journal";
export { receiptBarrier } from "@pe/runtime/work-journal";
export type { TimelineBarrier, TimelineEntry } from "@pe/runtime/work-journal";

// Presentation retention only; accepted Work and invocations replay from durable host history.
export const TIMELINE_LIMIT = 200;

export const timelineBarriers = (entries: readonly TimelineEntry[]): TimelineBarrier[] =>
  entries.flatMap((entry) => {
    const barrier = receiptBarrier(entry);
    return barrier ? [barrier] : [];
  });

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

/**
 * ADR 0030 rule 11: the Timeline is a projection. One row per invocation start, receipt, open
 * consent window and Work journal entry, all of which `createRouteTimeline` already holds as
 * entries. Labels derive here from the verb declarations; nothing stores one, so a label can never
 * contradict its receipt.
 */
export interface TimelineRow {
  at: TimelineEntry["at"];
  press: string;
  kind: "press" | "receipt" | "consent" | "journal";
  /** Derived: the route verb whose `does` is the receipt's command, else the command key. */
  verb: string;
  outcome?: InvocationOutcome;
  /** Open Reject? window: present only while the receipt's consent window is still open. */
  consentUntil?: string;
}
export function projectTimeline(
  _entries: readonly TimelineEntry[],
  _verbs: Readonly<Record<string, VerbDecl>>,
): TimelineRow[] {
  // ponytail: skeleton. Fill derives `verb` from `_verbs`, a consent row from `basis.receipt.consentWindow`,
  // and journal rows from recorded entries; then delete the stored `verb` written at append in
  // mount-timeline-owner.ts and the `verb` field on TimelineEntry.
  throw Error("projectTimeline is a step 2 scaffold; its fill follows");
}
