import { useRef } from "react";

import type { SessionFacts } from "#/host/target";
import { usePeInfo } from "#/host/info";
import { useLedger, type Stamped } from "#/host/ledger";
import { worldTrunk } from "#/targeting/world";

/** Broker bridge event as stamped on the `world` ledger (host `HostBridgeEvent`). */
export type HostLedgerEvent = Stamped<{
  sessionId: string;
  kind: "event" | "state-sync" | "connected" | "disconnected";
  eventName?: string;
  payloadJson?: string | null;
  origin?: string;
  docTitle?: string | null;
  docChanged?: boolean;
  prevDocTitle?: string | null;
}>;

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
 * Broker-fed world history: the `world` ledger replayed then live, one reducer. Timestamps are
 * broker truth (`atMs` stamped at publish), not tab observation. A host restart is a new epoch, so
 * the log resets instead of dropping the new boot's events.
 */
export function useWorldLog(sessions: SessionFacts[]): WorldEvent[] {
  const revit = usePeInfo().data?.capabilities.revit === true;
  // Label enrichment only — the ledger must not reopen on session-list churn.
  const sessionsRef = useRef(sessions);
  sessionsRef.current = sessions;
  const [log] = useLedger<HostLedgerEvent, WorldEvent[]>(
    revit ? "world" : null,
    (current, event) => {
      const world = toWorldEvent(event, sessionsRef.current);
      return world ? [...current.slice(-(LOG_CAP - 1)), world] : current;
    },
    () => [],
  );
  return log;
}
