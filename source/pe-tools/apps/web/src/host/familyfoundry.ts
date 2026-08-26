import type { FamilyfoundryPlan, FamilyfoundryProject } from "@pe/host-contracts/generated";

export type FfProjectData = FamilyfoundryProject.Res.Response;

/**
 * The settings module the plan op's profile type is persisted under. `familyfoundry.plan`
 * deserializes `DesiredFamilyMigrationProfile` strictly, and that type's settings registration
 * (Pe.Revit.FamilyFoundry/Profiles/DesiredFamilyMigrationSettingsRegistration.cs) is this module —
 * so this, not `CmdFFMigrator`/`CmdFFManager`, is the library the picker may honestly enumerate.
 */
export const FF_PROFILE_MODULE = {
  moduleKey: "CmdFFDesiredMigrator",
  rootKey: "profiles",
} as const;

/** Human-readable one-liner for a diagnostic — code first, because the code is the stable handle. */
export function diagnosticLine(diagnostic: FamilyfoundryPlan.Res.FamilyFoundryDiagnostic): string {
  return `${diagnostic.code} · ${diagnostic.path} — ${diagnostic.message}`;
}
