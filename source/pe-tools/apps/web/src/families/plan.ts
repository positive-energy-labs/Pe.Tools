import type { FfPlanEntry } from "@pe/agent-contracts";

type FfFamilyPlan = FfPlanEntry;
type FfReconciliationPlan = FfPlanEntry["plan"];

export function provenanceSummary(plan: FfReconciliationPlan): string {
  const counts = new Map<string, number>();
  for (const param of plan.parameters) {
    const facets = [
      param.provenance.identity,
      param.provenance.dataType,
      param.provenance.propertiesGroup,
      param.provenance.isInstance,
      param.provenance.tooltip,
    ];
    for (const facet of facets) {
      if (facet) counts.set(facet, (counts.get(facet) ?? 0) + 1);
    }
  }
  if (counts.size === 0) return "no provenance reported";
  return [...counts]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4)
    .map(([source, count]) => `${source} ×${count}`)
    .join(" · ");
}

/**
 * A planned family the apply lane must refuse. The op reports diagnostics at PROFILE level, not per
 * family, so the only honest per-family flag is an empty action set: the plan compiled, and it has
 * nothing to do here.
 */
export function familyFlag(entry: FfFamilyPlan): string | null {
  return entry.plan.loweredActions.length === 0
    ? "plan compiled with no actions for this family — nothing to apply"
    : null;
}

// ── the seam ────────────────────────────────────────────────────────────────────────────────────

/** Marks a surface whose LIVE behavior is unproven. Dashed = SEAM, and nothing else. */
