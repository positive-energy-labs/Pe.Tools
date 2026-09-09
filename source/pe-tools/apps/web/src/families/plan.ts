import type { FfPlanEntry } from "@pe/agent-contracts";

export function provenanceSummary(plan: FfPlanEntry): string {
  return (
    [
      ...plan.changes.map(
        (change) =>
          `${change.section}.${change.key}: ${change.kind}${change.mappedFrom ? ` from ${change.mappedFrom}` : ""}`,
      ),
      ...plan.runEffects,
    ].join(" ? ") || "no changes"
  );
}
export function familyFlag(entry: FfPlanEntry): string | null {
  return entry.refusals.length
    ? entry.refusals.map((issue) => `${issue.code}: ${issue.message}`).join(" ? ")
    : entry.changes.length + entry.runEffects.length === 0
      ? "nothing to apply"
      : null;
}
