import { showCellValue } from "@pe/agent-contracts";

/** Review and cells share one projection; the receipt retains authoritative structured values. */
export const reviewValue = showCellValue;
export const reviewChange = (before: unknown, after: unknown): string =>
  `${reviewValue(before)} \u2192 ${reviewValue(after)}`;

/** Native plans may nest under transport envelopes; every change uses the same exact projection. */
export function reviewChanges(evidence: unknown): string[] {
  if (Array.isArray(evidence)) return evidence.flatMap(reviewChanges);
  if (evidence === null || typeof evidence !== "object") return [];
  const record = evidence as Record<string, unknown>;
  const rows = Array.isArray(record.changes)
    ? record.changes.flatMap((change) => {
        if (!change || typeof change !== "object" || !("before" in change) || !("after" in change))
          return [];
        return [
          `${change.kind ?? "Change"} ${change.key ?? ""}: ${reviewChange(change.before, change.after)}`,
        ];
      })
    : [];
  return rows.concat(
    ["plan", "response", "value", "entries"].flatMap((key) => reviewChanges(record[key])),
  );
}
