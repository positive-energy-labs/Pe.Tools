/**
 * Family Foundry boundary — the FFMigrator lane (`/families`) talks to Revit through here.
 *
 * Fully typed: `familyfoundry.plan|apply|project` and `host.shell.open` all go through the
 * checked-in typegen output (`@pe/host-contracts/generated`). The `Ff*` aliases below exist so
 * the route speaks one short vocabulary; they are projections of the generated namespaces,
 * never parallel truth.
 *
 * Contract notes that shape the UI (read from the C# handler, not guessed):
 *   - Profile input is always INLINE JSON. No op accepts a profile path; the route reads the
 *     profile document's rawContent (settings.document.open) and passes the text.
 *   - `plan` derives its own family set from the profile (`profile.GetFamilies(document)`);
 *     `familyId` only NARROWS it to one. The table's scope does not select what is planned.
 *   - `planHash` is SHA-256 over the canonical reconciliation plan and excludes family selection,
 *     so the same hash is legitimately repeated on every family row.
 *   - `apply` refuses (`refused: true`) on empty familyIds, a blank expectedPlanHash, or hash
 *     drift; the response's own `planHash` is the recompiled truth to compare against.
 */
import { callHostRpc } from "#/host/client";
import type { HostSessionScope, HostShellOpenData } from "@pe/host-contracts/operation-types";
import type {
  FamilyfoundryApply,
  FamilyfoundryPlan,
  FamilyfoundryProject,
} from "@pe/host-contracts/generated";

export type FfDiagnostic = FamilyfoundryPlan.Res.FamilyFoundryDiagnostic;
export type FfReconciliationPlan = FamilyfoundryPlan.Res.FamilyFoundryReconciliationPlanData;
export type FfFamilyPlan = FamilyfoundryPlan.Res.FamilyFoundryFamilyPlanData;
export type FfPlanData = FamilyfoundryPlan.Res.Response;
export type FfApplyData = FamilyfoundryApply.Res.Response;
export type FfProjectData = FamilyfoundryProject.Res.Response;

/** Compile a profile into per-family reconciliation plans plus the drift hash. */
export function familyFoundryPlan(
  request: FamilyfoundryPlan.Req.Request,
  scope?: HostSessionScope,
): Promise<FfPlanData> {
  return callHostRpc("familyfoundry.plan", request, scope);
}

/** Migrate each explicit family independently; drift against `expectedPlanHash` is refused whole. */
export function familyFoundryApply(
  request: FamilyfoundryApply.Req.Request,
  scope?: HostSessionScope,
): Promise<FfApplyData> {
  return callHostRpc("familyfoundry.apply", request, scope);
}

/** Read selected loaded families back out as dense runnable FFManagerProfile JSON. */
export function familyFoundryProject(
  request: FamilyfoundryProject.Req.Request,
  scope?: HostSessionScope,
): Promise<FfProjectData> {
  return callHostRpc("familyfoundry.project", request, scope);
}

/** Open a receipt's artifact directory in the OS default handler. */
export function openHostPath(path: string, scope?: HostSessionScope): Promise<HostShellOpenData> {
  return callHostRpc("host.shell.open", { path }, scope);
}

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
export function diagnosticLine(diagnostic: FfDiagnostic): string {
  return `${diagnostic.code} · ${diagnostic.path} — ${diagnostic.message}`;
}
