import { useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";

import { HOST_QUERY_KEY } from "#/host/queries";
import { usePeInfo } from "#/host/info";

/** Broker bridge event as relayed on /events and replayed on /ledger (host HostBridgeEvent). */
export type HostLedgerEvent = {
  seq: number;
  atMs: number;
  sessionId: string;
  kind: "event" | "state-sync" | "connected" | "disconnected";
  eventName?: string;
  payloadJson?: string | null;
  origin?: string;
  docTitle?: string | null;
  docChanged?: boolean;
  prevDocTitle?: string | null;
};

// One EventSource shared by every subscriber in the tab, refcounted open/close.
let source: EventSource | null = null;
const listeners = new Set<(event: HostLedgerEvent) => void>();

/** Subscribe to live bridge events from the host SSE relay. Returns an unsubscribe. */
export function subscribeHostEvents(listener: (event: HostLedgerEvent) => void): () => void {
  listeners.add(listener);
  if (!source) {
    source = new EventSource("/events");
    source.onmessage = (message) => {
      const event = JSON.parse(message.data as string) as HostLedgerEvent;
      for (const l of listeners) l(event);
    };
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) {
      source?.close();
      source = null;
    }
  };
}

/**
 * Subscribes to the host's SSE relay of bridge events (Revit document changes,
 * state syncs, session connect/disconnect) and invalidates every host query on
 * any event. Mount once; every current and future host-backed route becomes
 * live with zero per-route work.
 *
 * ponytail: coarse invalidation — any bridge event refetches all active host
 * queries. Scope by sessionId/eventName when a route measurably suffers.
 */
export function useHostLiveInvalidation() {
  const queryClient = useQueryClient();
  const revit = usePeInfo().data?.capabilities.revit === true;
  useEffect(() => {
    if (!revit) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const unsubscribe = subscribeHostEvents(() => {
      // Revit sends Event + StateSync back-to-back per change; debounce to one refetch.
      clearTimeout(timer);
      timer = setTimeout(() => {
        void queryClient.invalidateQueries({ queryKey: HOST_QUERY_KEY });
      }, 150);
    });
    return () => {
      clearTimeout(timer);
      unsubscribe();
    };
  }, [queryClient, revit]);
}
