import { useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";

import { HOST_QUERY_KEY } from "#/host/queries";

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
  useEffect(() => {
    const source = new EventSource("/pe-host/events");
    let timer: ReturnType<typeof setTimeout> | undefined;
    source.onmessage = () => {
      // Revit sends Event + StateSync back-to-back per change; debounce to one refetch.
      clearTimeout(timer);
      timer = setTimeout(() => {
        void queryClient.invalidateQueries({ queryKey: HOST_QUERY_KEY });
      }, 150);
    };
    return () => {
      clearTimeout(timer);
      source.close();
    };
  }, [queryClient]);
}
