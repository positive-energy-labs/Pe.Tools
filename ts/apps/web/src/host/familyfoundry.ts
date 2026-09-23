import type { FfPlanEntry } from "@pe/agent-contracts";

import type { PlanEntry } from "#/route/manifest";
import type { FamiliesPlan } from "@pe/host-contracts/generated";

/** The `$schema` path that says a member is a Family Foundry spec (`{ select, patch, run }`). */
export const FF_SPEC_SCHEMA = "/schemas/settings/FamilyFoundry/patches.json";

function warningLine(warning: FamiliesPlan.Res.RevitDataIssue): string {
  const subject = [warning.familyName, warning.typeName, warning.parameterName]
    .filter(Boolean)
    .join(" / ");
  return `${subject ? `${subject} — ` : ""}${warning.message}`;
}

/** Which layers of the spec decided this family's edits, as the plan reported them. */
function provenanceSummary(plan: FfPlanEntry): string {
  return (
    [
      ...plan.changes.map((change) => {
        const { after } = change as typeof change & { after?: unknown };
        const kind =
          change.kind === "Update" &&
          (after === "" ||
            (Array.isArray(after) && after.length === 0) ||
            (after !== null && typeof after === "object" && Object.keys(after).length === 0))
            ? "set to empty"
            : change.kind;
        return `${change.section}.${change.key}: ${kind}${change.mappedFrom ? ` from ${change.mappedFrom}` : ""}`;
      }),
      ...plan.runEffects,
    ].join(" · ") || "no changes"
  );
}

/** Why a family plan cannot be applied: its refusals, or nothing to do. null = applicable. */
function familyFlag(entry: FfPlanEntry): string | null {
  return entry.refusals.length
    ? entry.refusals.map((issue) => `${issue.code}: ${issue.message}`).join(" · ")
    : entry.changes.length + entry.runEffects.length === 0
      ? "nothing to apply"
      : null;
}

/** One Family Foundry plan (from `families.plan` or `family.plan`) as a sheet row. */
export const ffPlanRow = (entry: FfPlanEntry): PlanEntry => ({
  // Identity by NAME (ruling): the row is its family; the id the plan resolved is only apply's key.
  id: entry.familyName,
  ...(entry.familyId != null ? { hashKey: String(entry.familyId) } : {}),
  name: entry.familyName,
  planHash: entry.planHash,
  actions: entry.changes.length + entry.runEffects.length,
  detail: provenanceSummary(entry),
  flag: familyFlag(entry),
  warnings: entry.warnings.map((warning) => `${warning.code} · ${warningLine(warning)}`),
});
