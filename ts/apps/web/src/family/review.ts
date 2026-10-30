import type { FamilyPlanResult } from "@pe/agent-contracts";
import type { VerbPresentation } from "#/shell/verbs";

/** Family and Families review the same native plan, including refusals and run effects. */
export function presentFamilyPlan(result: unknown): VerbPresentation {
  const plan = (result as { plan?: FamilyPlanResult }).plan;
  if (!plan) return { sentence: "Family changes applied.", rows: [] };
  const entries = Array.isArray(plan.plan) ? plan.plan : [plan.plan];
  const changes = entries.reduce((count, entry) => count + entry.changes.length, 0);
  const refused = entries.reduce((count, entry) => count + entry.refusals.length, 0);
  const scalar = (value: unknown): value is string | number | boolean | null =>
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean";
  return {
    sentence: `Review ${entries.length} ${entries.length === 1 ? "family" : "families"}: ${changes} ${changes === 1 ? "change" : "changes"}, ${refused} ${refused === 1 ? "refusal" : "refusals"}.`,
    rows: entries
      .flatMap((entry) => [
        `${entry.familyName}: ${entry.changes.length} ${entry.changes.length === 1 ? "change" : "changes"}`,
        ...entry.changes.map(
          (change) =>
            `${change.kind} ${change.key}${scalar(change.before) && scalar(change.after) ? `: ${String(change.before ?? "none")} → ${String(change.after ?? "none")}` : ""}`,
        ),
        ...entry.refusals.map((refusal) => `Refused: ${refusal.message}`),
        ...entry.warnings.map((warning) => `Warning: ${warning.message}`),
        ...entry.runEffects,
      ])
      .concat([
        ...(plan.excluded?.length ? [`${plan.excluded.length} excluded changes`] : []),
        ...(plan.orphaned ?? []).map((name) => `Orphaned: ${name}`),
      ]),
  };
}
