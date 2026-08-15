/**
 * Family Foundry boundary — the FFMigrator lane (`/families`) talks to Revit through here.
 *
 * SEAM: `familyfoundry.plan|apply|project` are live C# bridge ops
 * (source/Pe.App/Host/FamilyFoundryBridgeOps.cs) whose DTOs are authored in
 * Pe.Shared.HostContracts/Operations/FamilyFoundryHostContracts.cs, but they are NOT yet in the
 * checked-in typegen output (`@pe/host-contracts/generated`). Until a codegen run against a live
 * host catalog lands them, this module hand-mirrors those DTOs and dials them through
 * `callHostDynamic`. Every function below names the generated client that replaces it; when that
 * client exists, delete the mirrored interface and the cast, not the call site.
 *
 * `host.shell.open` is NOT a seam — it is a checked-in TS-only op, so it goes through the typed
 * client and is re-exported here only so the route has one Family Foundry surface to import.
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
import { callHostDynamic, callHostRpc } from "#/host/client";
import type { HostSessionScope, HostShellOpenData } from "@pe/host-contracts/operation-types";

/** A named, path-addressed complaint from the compiler or the op boundary. */
export interface FfDiagnostic {
  code: string;
  path: string;
  message: string;
  suggestion?: string | null;
}

export interface FfLoweredAction {
  operation: string;
  target: string;
  sources: string[];
  reason: string;
}

/** Per-field provenance: which layer of the profile decided each facet of the definition. */
export interface FfParameterProvenance {
  identity: string;
  dataType: string;
  propertiesGroup: string;
  isInstance: string;
  tooltip: string;
}

export interface FfResolvedParameterDefinition {
  identity: unknown;
  name: string;
  dataTypeId: string;
  propertiesGroupId: string;
  isInstance: boolean;
  tooltip?: string | null;
}

export interface FfResolvedParameter {
  definition: FfResolvedParameterDefinition;
  isShared: boolean;
  assignment?: { kind: string; value: string } | null;
  valuesByType: Record<string, string | null>;
  migration?: {
    sourceNames: string[];
    onlyAddIfSourceExists: boolean;
    mappingStrategy: string;
  } | null;
  provenance: FfParameterProvenance;
}

export interface FfReconciliationPlan {
  parameters: FfResolvedParameter[];
  requiredApsParameterNames: string[];
  familyParameterNames: string[];
  loweredActions: FfLoweredAction[];
}

export interface FfFamilyPlan {
  familyId: number;
  familyName: string;
  plan: FfReconciliationPlan;
}

export interface FfPlanData {
  planHash: string | null;
  families: FfFamilyPlan[];
  diagnostics: FfDiagnostic[];
}

export interface FfDiffSummary {
  added: number;
  removed: number;
  modified: number;
}

export interface FfApplyReceipt {
  familyId: number;
  familyName?: string | null;
  success: boolean;
  error?: string | null;
  operationsRun: string[];
  parametersChanged: number;
  diffSummary: FfDiffSummary;
  artifactDirectoryPath?: string | null;
}

export interface FfApplyData {
  planHash: string | null;
  refused: boolean;
  receipts: FfApplyReceipt[];
  diagnostics: FfDiagnostic[];
}

export interface FfProjection {
  familyId: number;
  familyName?: string | null;
  success: boolean;
  profileJson?: string | null;
  error?: string | null;
}

export interface FfProjectData {
  projections: FfProjection[];
  diagnostics: FfDiagnostic[];
}

/**
 * Compile a profile into per-family reconciliation plans plus the drift hash.
 * seam: replaced by the generated `FamilyfoundryPlan` client (`@pe/host-contracts/generated`).
 */
export async function familyFoundryPlan(
  request: { profileJson: string; familyId?: number },
  scope?: HostSessionScope,
): Promise<FfPlanData> {
  return (await callHostDynamic("familyfoundry.plan", request, scope)) as FfPlanData;
}

/**
 * Migrate each explicit family independently; drift against `expectedPlanHash` is refused whole.
 * seam: replaced by the generated `FamilyfoundryApply` client (`@pe/host-contracts/generated`).
 */
export async function familyFoundryApply(
  request: { profileJson: string; familyIds: number[]; expectedPlanHash: string },
  scope?: HostSessionScope,
): Promise<FfApplyData> {
  return (await callHostDynamic("familyfoundry.apply", request, scope)) as FfApplyData;
}

/**
 * Read selected loaded families back out as dense runnable FFManagerProfile JSON.
 * seam: replaced by the generated `FamilyfoundryProject` client (`@pe/host-contracts/generated`).
 */
export async function familyFoundryProject(
  request: { familyIds: number[] },
  scope?: HostSessionScope,
): Promise<FfProjectData> {
  return await (callHostDynamic("familyfoundry.project", request, scope) as Promise<FfProjectData>);
}

/** Open a receipt's artifact directory in the OS default handler. Typed today — not a seam. */
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
