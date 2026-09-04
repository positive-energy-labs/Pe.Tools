import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useState } from "react";

import { useHostEvents } from "#/host/events";
import { HOST_QUERY_KEY } from "#/host/queries";
import { usePeInfo } from "#/host/info";

/**
 * Invalidates every host query on any world event (Revit document changes, state syncs,
 * session connect/disconnect). Mount once; every current and future host-backed route becomes
 * live with zero per-route work.
 *
 * ponytail: coarse invalidation — any bridge event refetches all active host
 * queries. Scope by sessionId/eventName when a route measurably suffers.
 */
export function useHostLiveInvalidation() {
  const queryClient = useQueryClient();
  const revit = usePeInfo().data?.capabilities.revit === true;
  const [tick, setTick] = useState(0);
  useHostEvents(
    revit,
    useCallback(() => setTick((count) => count + 1), []),
  );
  useEffect(() => {
    if (!tick) return;
    // Revit sends Event + StateSync back-to-back per change; debounce to one refetch.
    const timer = setTimeout(() => {
      void queryClient.invalidateQueries({ queryKey: HOST_QUERY_KEY });
    }, 150);
    return () => clearTimeout(timer);
  }, [queryClient, tick]);
}
