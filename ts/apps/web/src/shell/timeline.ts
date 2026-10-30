import type { RouteStatePatch } from "@pe/agent-contracts";

export interface TimelineEntry {
  kind: "invocation" | "receipt" | "checkpoint" | "feed";
  at: string | number;
  press?: string;
  verb?: string;
  subject?: unknown;
  receiptId?: string;
  paths?: readonly RouteStatePatch["path"][];
  basis?: unknown;
}

// Keep the last 200 route interactions in memory; durable History needs checkpoint storage.
export const TIMELINE_LIMIT = 200;

export type TimelineBarrier = TimelineEntry & {
  kind: "receipt";
  paths: readonly RouteStatePatch["path"][];
};

/** A receipt without a path footprint cannot claim to block unrelated Work. [] inside paths is the root. */
export function receiptBarrier(entry: TimelineEntry): TimelineBarrier | null {
  return entry.kind === "receipt" && entry.paths?.length
    ? (structuredClone(entry) as TimelineBarrier)
    : null;
}

export const timelineBarriers = (entries: readonly TimelineEntry[]): TimelineBarrier[] =>
  entries.flatMap((entry) => {
    const barrier = receiptBarrier(entry);
    return barrier ? [barrier] : [];
  });

/** One instance per mounted route. Append order, rather than wall-clock order, is authoritative. */
export function createRouteTimeline() {
  let entries: TimelineEntry[] = [];
  const listeners = new Set<(entry: TimelineEntry) => void>();
  return {
    append(entry: TimelineEntry): void {
      const recorded = structuredClone(entry);
      entries = [...entries, recorded].slice(-TIMELINE_LIMIT);
      for (const listener of listeners) listener(structuredClone(recorded));
    },
    read: (): readonly TimelineEntry[] => structuredClone(entries),
    subscribe(listener: (entry: TimelineEntry) => void): () => void {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

export type RouteTimeline = ReturnType<typeof createRouteTimeline>;
