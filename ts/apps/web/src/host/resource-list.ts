import type { ListReading } from "@pe/kit/lang/collection";
import type { ReadingState } from "../shell/source-contract";

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
