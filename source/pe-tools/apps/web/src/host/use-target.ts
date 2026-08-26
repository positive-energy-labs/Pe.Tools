import { useEffect, useRef, useState } from "react";

import type { SessionFacts } from "#/host/target";
import { worldTrunk } from "#/targeting/trunks";

type WorldEventKind = "session-appeared" | "session-gone" | "doc-changed";

export interface WorldEvent {
  atMs: number;
  kind: WorldEventKind;
  sessionId: string;
  label: string;
}

/** Timestamps are when this tab observed the session-list change, not broker truth. */
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
          label: `${worldTrunk.label({ pid: s.processId, session: s })} · ${s.activeDocumentTitle ?? `Revit ${s.processId}`} connected`,
        });
      } else if (old.activeDocumentId !== s.activeDocumentId) {
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
  }, [sessions.map((s) => `${s.sessionId}:${s.activeDocumentId ?? ""}`).join("|")]); // eslint-disable-line react-hooks/exhaustive-deps

  return log;
}
