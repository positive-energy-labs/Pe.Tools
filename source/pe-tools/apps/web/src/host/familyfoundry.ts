import type { FamilyfoundryPlan, FamilyfoundryProject } from "@pe/host-contracts/generated";

export type FfProjectData = FamilyfoundryProject.Res.Response;

export const FF_PROFILE_MODULE = {
  moduleKey: "FamilyFoundry",
  rootKey: "patches",
} as const;

/** Human-readable one-liner for a diagnostic — code first, because the code is the stable handle. */
export function diagnosticLine(diagnostic: FamilyfoundryPlan.Res.FamilyFoundryDiagnostic): string {
  return `${diagnostic.code} · ${diagnostic.path} — ${diagnostic.message}`;
}
