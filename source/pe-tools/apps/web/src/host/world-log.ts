import { useCallback, useRef, useState } from "react";

import type { SessionInventory } from "#/readings";
import { previousOf, useHostEvents, useHostStatus } from "#/readings";

type HostEvent = {
  atMs: number;
  sessionId: string;
  kind: "event" | "state-sync" | "connected" | "disconnected" | "gap";
  dropped?: number | null;
  eventName?: string;
  payloadJson?: string | null;
  origin?: string;
  docTitle?: string | null;
  docChanged?: boolean;
  prevDocTitle?: string | null;
};

type WorldEventKind = "session-appeared" | "session-gone" | "doc-changed" | "gap";

export interface SessionEvent {
  atMs: number;
  kind: WorldEventKind;
  sessionId: string;
  label: string;
}

const LOG_CAP = 100;

function toWorldEvent(event: HostEvent, sessions: SessionInventory[]): SessionEvent | null {
  const base = { atMs: event.atMs, sessionId: event.sessionId };
  switch (event.kind) {
    case "gap":
      return {
        ...base,
        kind: "gap",
        label:
          event.dropped == null
            ? "World history unavailable across connection gap"
            : `${event.dropped} World events omitted by slow reader`,
      };
    case "connected": {
      const session = sessions.find((s) => s.sessionId === event.sessionId);
      const who = session
        ? (session.sdkSessionId ?? `Revit ${session.processId}`)
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
 * Broker-fed world history. Timestamps are host publish time, not tab observation time.
 */
export function useWorldLog(sessions: SessionInventory[]): SessionEvent[] {
  const revit = previousOf(useHostStatus())?.capabilities.revit === true;
  // Label enrichment only — the stream must not reopen on session-list churn.
  const sessionsRef = useRef(sessions);
  sessionsRef.current = sessions;
  const [log, setLog] = useState<SessionEvent[]>([]);
  useHostEvents<HostEvent>(
    revit,
    useCallback((event) => {
      const world = toWorldEvent(event, sessionsRef.current);
      if (world) setLog((current) => [...current.slice(-(LOG_CAP - 1)), world]);
    }, []),
  );
  return log;
}
