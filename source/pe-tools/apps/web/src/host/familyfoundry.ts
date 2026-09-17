import type { PodMember } from "@pe/agent-contracts";
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
