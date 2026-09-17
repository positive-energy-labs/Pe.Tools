import type { FfPlanEntry, PodMember } from "@pe/agent-contracts";

import type { PlanEntry } from "#/route/manifest";
import type { FamiliesCapture, FamiliesPlan } from "@pe/host-contracts/generated";

export type FfProjectData = FamiliesCapture.Res.Response;

/** The `$schema` path that says a member is a Family Foundry spec (`{ select, patch, run }`). */
export const FF_SPEC_SCHEMA = "/schemas/settings/FamilyFoundry/patches.json";

/** A member as one picker id; the pod id never contains the separator a path cannot start with. */
export const memberKey = (member: PodMember) => `${member.pod}:${member.path}`;
export const memberOfKey = (key: string): PodMember => {
  const at = key.indexOf(":");
  return { pod: key.slice(0, at), path: key.slice(at + 1) };
};

/** Human-readable one-liner for a diagnostic — code first, because the code is the stable handle. */
export function diagnosticLine(diagnostic: FamiliesPlan.Res.FamilyFoundryDiagnostic): string {
  return `${diagnostic.code} · ${diagnostic.path} — ${diagnostic.message}`;
}

export function warningLine(warning: FamiliesPlan.Res.RevitDataIssue): string {
  const subject = [warning.familyName, warning.typeName, warning.parameterName]
    .filter(Boolean)
    .join(" / ");
  return `${subject ? `${subject} — ` : ""}${warning.message}`;
}

/** Which layers of the spec decided this family's edits, as the plan reported them. */
export function provenanceSummary(plan: FfPlanEntry): string {
  return (
    [
      ...plan.changes.map(
        (change) =>
          `${change.section}.${change.key}: ${change.kind}${change.mappedFrom ? ` from ${change.mappedFrom}` : ""}`,
      ),
      ...plan.runEffects,
    ].join(" · ") || "no changes"
  );
}

/** Why a family plan cannot be applied: its refusals, or nothing to do. null = applicable. */
export function familyFlag(entry: FfPlanEntry): string | null {
  return entry.refusals.length
    ? entry.refusals.map((issue) => `${issue.code}: ${issue.message}`).join(" · ")
    : entry.changes.length + entry.runEffects.length === 0
      ? "nothing to apply"
      : null;
}

/** One Family Foundry plan (from `families.plan` or `family.apply`'s first admission) as a sheet row. */
export const ffPlanRow = (entry: FfPlanEntry): PlanEntry => ({
  id: String(entry.familyId),
  name: entry.familyName,
  planHash: entry.planHash,
  actions: entry.changes.length + entry.runEffects.length,
  detail: provenanceSummary(entry),
  flag: familyFlag(entry),
  warnings: entry.warnings.map((warning) => `${warning.code} · ${warningLine(warning)}`),
});
