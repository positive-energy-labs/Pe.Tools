import { useEffect, useRef, useState } from "react";

import { useBridgeSessionsListQuery } from "#/host/queries";
import {
  fromBridgeSessions,
  resolveTarget,
  type SessionFacts,
  type TargetResolution,
  type TargetSelector,
} from "#/host/target";

/**
 * Resolve a target selector against the live session list. The caller owns WHERE the selector
 * is stored (chat search param, route search param, plugin state); this hook owns resolution.
 * Root-mounted SSE invalidation keeps the underlying query live; no per-surface refresh needed.
 */
export function useTarget(selector: TargetSelector): {
  resolution: TargetResolution;
  sessions: SessionFacts[];
  isLoading: boolean;
} {
  const query = useBridgeSessionsListQuery();
  const sessions = fromBridgeSessions(query.data?.sessions ?? []);
  return {
    resolution: resolveTarget(sessions, selector),
    sessions,
    isLoading: query.isLoading,
  };
}

// ── world log — client-observed world events, for the thread lane ───────────────────────────────

export type WorldEventKind = "session-appeared" | "session-gone" | "doc-changed";

export interface WorldEvent {
  atMs: number;
  kind: WorldEventKind;
  sessionId: string;
  label: string;
}

/**
 * Derives world events by diffing consecutive session-list observations. Client-observed
 * (timestamps are when THIS tab noticed, within the SSE debounce of reality) — good enough to
 * align world changes with conversation time; never presented as broker truth.
 */
export function useWorldLog(sessions: SessionFacts[]): WorldEvent[] {
  const [log, setLog] = useState<WorldEvent[]>([]);
  const prev = useRef<Map<string, SessionFacts> | null>(null);

  useEffect(() => {
    const now = new Map(sessions.map((s) => [s.sessionId, s]));
    const before = prev.current;
    prev.current = now;
    if (before === null) return; // first observation is a baseline, not an event
    const events: WorldEvent[] = [];
    const atMs = Date.now();
    for (const [id, s] of now) {
      const old = before.get(id);
      if (!old) {
        events.push({
          atMs,
          kind: "session-appeared",
          sessionId: id,
          label: `${s.lane === "sandbox" ? (s.sandboxId ?? "sandbox") : "user"} · ${s.activeDocumentTitle ?? `Revit ${s.processId}`} connected`,
        });
      } else if (old.activeDocumentTitle !== s.activeDocumentTitle) {
        events.push({
          atMs,
          kind: "doc-changed",
          sessionId: id,
          label: `${old.activeDocumentTitle ?? "∅"} → ${s.activeDocumentTitle ?? "∅"}`,
        });
      }
    }
    for (const [id, old] of before) {
      if (!now.has(id))
        events.push({
          atMs,
          kind: "session-gone",
          sessionId: id,
          label: `${old.activeDocumentTitle ?? `Revit ${old.processId}`} disconnected`,
        });
    }
    if (events.length) setLog((l) => [...l.slice(-99), ...events]); // ponytail: capped ring, per-tab only
    // Keyed by identity+doc signature so unrelated field churn doesn't re-diff.
  }, [sessions.map((s) => `${s.sessionId}:${s.activeDocumentTitle ?? ""}`).join("|")]); // eslint-disable-line react-hooks/exhaustive-deps

  return log;
}
