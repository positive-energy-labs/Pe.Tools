import { useSyncExternalStore } from "react";
import { Button } from "@pe/kit/lang/button";
import { RefreshCw } from "lucide-react";
import type { ListReading } from "@pe/kit/lang/collection";
import type { ReadingState } from "./readings";
import type { GraphMount } from "./mount-owner";

/**
 * ADR 0027 rule 9: the pane head's own loading word and refresh verb over its draws' closure. The
 * body keeps drawing `value ?? previous`, so old content stays while a refresh runs.
 */
export function PaneHead<P, W>({
  owner,
  draws,
  enabled,
  refresh,
}: {
  owner: GraphMount<P, W>;
  draws: readonly string[];
  enabled: boolean;
  /** The graph's refresh verb: one press reads the host again and invalidates what it dirties. */
  refresh?: string;
}) {
  const status = useSyncExternalStore(
    (notify) => owner.readings.watch(draws, notify),
    () => owner.readings.status(draws),
  );
  if (!draws.length) return null;
  const failed = status.startsWith("failed:") ? status.slice("failed:".length) : null;
  return (
    <>
      {status !== "ready" && (
        <span
          role="status"
          data-slot="pane-reading"
          data-tone={failed ? "caution" : undefined}
          className="text-ink-2 t-small"
        >
          {failed ? "failed" : status === "pending" ? "reading…" : "stale"}
        </span>
      )}
      {failed && draws.some((id) => owner.readings.get(id).errorDetails) && (
        <details className="t-small text-ink-2">
          <summary>Details</summary>
          <pre>
            {draws
              .map((id) => owner.readings.get(id).errorDetails)
              .filter(Boolean)
              .join("\n")}
          </pre>
        </details>
      )}
      <Button
        label="Refresh"
        icon={RefreshCw}
        refusal={enabled ? (refresh ? owner.control(refresh).refusal : null) : "pane hidden"}
        onClick={() =>
          refresh ? void owner.control(refresh).run() : owner.readings.refresh(draws)
        }
      />
    </>
  );
}

/** Bridge the shell's freshness state to kit lists without inventing transport provenance. */
export function readingList<T, Row>(reading: ReadingState<T>, rows: (value: T) => readonly Row[]) {
  const value = reading.value ?? reading.previous;
  return {
    items: value === undefined ? [] : rows(value),
    status: (reading.status === "failed"
      ? "failed"
      : reading.current
        ? "ready"
        : "pending") as ListReading,
    failure: reading.error,
  };
}
