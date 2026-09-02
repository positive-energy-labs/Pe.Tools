import { useEffect, useRef, useState } from "react";

import type { SessionFacts } from "#/host/target";
import { usePeInfo } from "#/host/info";
import { subscribeHostEvents, type HostLedgerEvent } from "#/host/live";
import { worldTrunk } from "#/targeting/world";

type WorldEventKind = "session-appeared" | "session-gone" | "doc-changed";

export interface WorldEvent {
  atMs: number;
  kind: WorldEventKind;
  sessionId: string;
  label: string;
}

const LOG_CAP = 100;

function toWorldEvent(event: HostLedgerEvent, sessions: SessionFacts[]): WorldEvent | null {
  const base = { atMs: event.atMs, sessionId: event.sessionId };
  switch (event.kind) {
    case "connected": {
      const session = sessions.find((s) => s.sessionId === event.sessionId);
      const who = session
        ? worldTrunk.label({
            id: session.sdkSessionId ?? String(session.processId),
            custody: session.custody,
            session,
          })
        : event.sessionId;
      return {
        ...base,
        kind: "session-appeared",
        label: `${who} · ${event.docTitle ?? "Revit"} connected`,
      };
    }
    case "disconnected":
      return {
        ...base,
        kind: "session-gone",
        label: `${event.docTitle ?? event.sessionId} disconnected`,
      };
    case "state-sync":
      if (!event.docChanged) return null;
      return {
        ...base,
        kind: "doc-changed",
        label: `${event.prevDocTitle ?? "∅"} → ${event.docTitle ?? "∅"}`,
      };
    default:
      return null; // raw Revit events (cache invalidations) are not world history
  }
}

/**
 * Broker-fed world history: replays the host's bounded event ring (`GET /ledger`) once, then
 * stays live on the shared /events SSE subscription, deduping by broker `seq`. Timestamps are
 * broker truth (`atMs` stamped at publish), not tab observation.
 */
export function useWorldLog(sessions: SessionFacts[]): WorldEvent[] {
  const revit = usePeInfo().data?.capabilities.revit === true;
  const [log, setLog] = useState<WorldEvent[]>([]);
  const lastSeq = useRef(0);
  // Label enrichment only — the effect must not re-run on session-list churn.
  const sessionsRef = useRef(sessions);
  sessionsRef.current = sessions;

  useEffect(() => {
    if (!revit) return;
    let cancelled = false;
    const accept = (event: HostLedgerEvent) => {
      if (event.seq <= lastSeq.current) return; // already replayed or delivered
      lastSeq.current = event.seq;
      const world = toWorldEvent(event, sessionsRef.current);
      if (world) setLog((l) => [...l.slice(-(LOG_CAP - 1)), world]);
    };
    // Subscribe first and buffer, so nothing published between the /ledger snapshot
    // and the SSE attach is lost; seq dedupe removes the overlap.
    let replayed = false;
    const buffer: HostLedgerEvent[] = [];
    const unsubscribe = subscribeHostEvents((event) =>
      replayed ? accept(event) : buffer.push(event),
    );
    const flush = (events: HostLedgerEvent[]) => {
      if (cancelled) return;
      for (const event of events) accept(event);
      for (const event of buffer) accept(event);
      buffer.length = 0;
      replayed = true;
    };
    void fetch("/ledger")
      .then((res) => (res.ok ? (res.json() as Promise<{ events: HostLedgerEvent[] }>) : null))
      .then((body) => flush(body?.events ?? []))
      .catch(() => flush([]));
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [revit]);

  return log;
}
