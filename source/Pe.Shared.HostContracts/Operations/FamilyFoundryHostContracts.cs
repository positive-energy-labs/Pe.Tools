using Pe.Shared.RevitData.Families;
using Pe.Shared.RevitData;

namespace Pe.Shared.HostContracts.Operations;

/// <summary>Diagnostic for the Family Foundry host operations: a closed code, a JSON path, a message, an optional fix.</summary>
public sealed record FamilyFoundryDiagnostic(string Code, string Path, string Message, string? Suggestion = null);

/// <summary>Plan a spec (`{ select, patch, run }` JSON) against the active family document.</summary>
public sealed record FamilyPlanRequest(string SpecJson, ExecutionOptions? ExecutionOptions = null);

/// <summary>
///     Plan a spec against exactly the named loaded families (exact, case-sensitive, no duplicates); the spec's `select` is the
///     default scope only when none are passed. A name is the stable identity: an id names one load only.
/// </summary>
public sealed record FamiliesPlanRequest(string SpecJson, IReadOnlyList<string>? FamilyNames = null, ExecutionOptions? ExecutionOptions = null);

/// <summary>One change the reconciler would make: section + key is the address, kind is the verb.</summary>
public sealed record FamilyFoundryChangeData(string Section, string Key, string Kind, string? MappedFrom);

/// <summary>
///     One planned family. `familyName` is the requested name byte-exact; `familyId` is the id it resolved to at plan, null when
///     the name refused (`family-not-found`, `family-name-ambiguous`, `family-not-editable` in `refusals`).
/// </summary>
public sealed record FamilyFoundryFamilyPlanData(
    long? FamilyId,
    string FamilyName,
    string PlanHash,
    IReadOnlyList<FamilyFoundryChangeData> Changes,
    IReadOnlyList<string> RunEffects,
    IReadOnlyList<FamilyFoundryDiagnostic> Refusals,
    IReadOnlyList<RevitDataIssue> Warnings
);

public sealed record FamilyFoundryPlanData(
    IReadOnlyList<FamilyFoundryFamilyPlanData> Families,
    IReadOnlyList<FamilyFoundryDiagnostic> Diagnostics
);

/// <summary>
///     Apply a saved spec to the active family document; the family's `expectedPlanHash` from family.plan
///     gates drift. One key, the active document's owner family — the same shape `families.apply` takes, so
///     one apply grammar serves both routes. The document is not saved.
/// </summary>
/// <remarks>`Plan` is the host plan action whose sealed preparation this apply consumes; a direct call has none.</remarks>
public sealed record FamilyApplyRequest(string SpecJson, IReadOnlyDictionary<long, string> ExpectedPlanHashes, PodComposedSource Source, ExecutionOptions? ExecutionOptions = null, string? Plan = null);

/// <summary>
///     Apply a saved spec to explicit loaded families; each family's `expectedPlanHash` from families.plan gates drift. Both maps are
///     keyed by the id resolved at plan; `familyNames` holds each one's plan name, re-resolved at apply: a family whose name now
///     resolves to another id was reloaded since the plan and is refused by name.
/// </summary>
public sealed record FamiliesApplyRequest(string SpecJson, IReadOnlyDictionary<long, string> ExpectedPlanHashes, IReadOnlyDictionary<long, string> FamilyNames, PodComposedSource Source, ExecutionOptions? ExecutionOptions = null, string? Plan = null);

/// <summary>
///     The receipt: outcomes per change, residue after re-capture, converged = residue 0 and no errors. `familyId` is the
///     id the apply was asked for (its `expectedPlanHashes` key). A reload gives the family a new element id, so
///     `loadedFamilyId` is the id it has now, null when nothing reloaded; an element id names one load, and only
///     `familyName` (as re-resolved at apply) is stable across applies.
/// </summary>
public sealed record FamilyFoundryApplyReceipt(
    long FamilyId,
    string FamilyName,
    bool Success,
    bool Converged,
    string? Error,
    string? PlanHash,
    IReadOnlyList<FamilyFoundryChangeData> Residue,
    IReadOnlyList<string> Errors,
    string? ArtifactDirectory,
    string? ObservedParametersDigest = null,
    long? LoadedFamilyId = null
);

/// <summary>
///     `receiptPath` is the pod run's receipt.json; null when the request was refused before running. `reason` is the
///     receipt's: one sentence naming the first failure, null when none failed; the full text is the run's `failures.json`.
/// </summary>
public sealed record FamilyFoundryApplyData(
    IReadOnlyList<FamilyFoundryApplyReceipt> Receipts,
    IReadOnlyList<FamilyFoundryDiagnostic> Diagnostics,
    string? ReceiptPath = null,
    string? Reason = null
);

/// <summary>Capture loaded families read-only as family.json.</summary>
public sealed record FamiliesCaptureRequest(IReadOnlyList<long> FamilyIds);

public sealed record FamilyFoundryFamilyModelData(
    long FamilyId,
    string? FamilyName,
    bool Success,
    string? ModelJson,
    IReadOnlyDictionary<string, string> Coverage,
    int UnmodeledCount,
    IReadOnlyList<RevitDataIssue> Issues,
    string? Error
);

public sealed record FamiliesCaptureData(
    IReadOnlyList<FamilyFoundryFamilyModelData> Families,
    IReadOnlyList<FamilyFoundryDiagnostic> Diagnostics
);
