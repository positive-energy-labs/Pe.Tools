import { reviewChanges } from "#/shell/review-value";
import type { FamilyPlanResult } from "@pe/agent-contracts";
import {type VerbPresentation} from "#/shell/review-contract";

/** Family and Families review the same native plan, including refusals and run effects. */
export function presentFamilyPlan(result: unknown): VerbPresentation {
  const plan = (result as { plan?: FamilyPlanResult }).plan;
  if (!plan) return { sentence: "Family changes applied.", rows: [] };
  const entries = Array.isArray(plan.plan) ? plan.plan : [plan.plan];
  const changes = entries.reduce((count, entry) => count + entry.changes.length, 0);
  const refused = entries.reduce((count, entry) => count + entry.refusals.length, 0);
  return {
    sentence: `Review ${entries.length} ${entries.length === 1 ? "family" : "families"}: ${changes} ${changes === 1 ? "change" : "changes"}, ${refused} ${refused === 1 ? "refusal" : "refusals"}.`,
    rows: entries
      .flatMap((entry) => [
        `${entry.familyName}: ${entry.changes.length} ${entry.changes.length === 1 ? "change" : "changes"}`,
        ...reviewChanges(entry),
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
