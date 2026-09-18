using Pe.Shared.RevitData.Families;
using Pe.Shared.RevitData;

namespace Pe.Shared.HostContracts.Operations;

/// <summary>Diagnostic for the Family Foundry host operations: a closed code, a JSON path, a message, an optional fix.</summary>
public sealed record FamilyFoundryDiagnostic(string Code, string Path, string Message, string? Suggestion = null);

/// <summary>Plan a spec (`{ select, patch, run }` JSON) against the active family document.</summary>
public sealed record FamilyPlanRequest(string SpecJson, ExecutionOptions? ExecutionOptions = null);

/// <summary>Plan a spec against exactly the target's resolved family ids; the spec's `select` is the default scope only when none are passed.</summary>
public sealed record FamiliesPlanRequest(string SpecJson, IReadOnlyList<long>? FamilyIds = null, ExecutionOptions? ExecutionOptions = null);

/// <summary>One change the reconciler would make: section + key is the address, kind is the verb.</summary>
public sealed record FamilyFoundryChangeData(string Section, string Key, string Kind, string? MappedFrom);

public sealed record FamilyFoundryFamilyPlanData(
    long FamilyId,
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
public sealed record FamilyApplyRequest(string SpecJson, IReadOnlyDictionary<long, string> ExpectedPlanHashes, PodComposedSource Source, ExecutionOptions? ExecutionOptions = null);

/// <summary>Apply a saved spec to explicit loaded families; each family's `expectedPlanHash` from families.plan gates drift.</summary>
public sealed record FamiliesApplyRequest(string SpecJson, IReadOnlyDictionary<long, string> ExpectedPlanHashes, PodComposedSource Source, ExecutionOptions? ExecutionOptions = null);

/// <summary>
///     The receipt: outcomes per change, residue after re-capture, converged = residue 0 and no errors. `familyId` is the
///     id the apply was asked for (its `expectedPlanHashes` key). A reload gives the family a new element id, so
///     `loadedFamilyId` is the id it has now, null when nothing reloaded; an element id names one load, and only the
///     family name is stable across applies.
/// </summary>
public sealed record FamilyFoundryApplyReceipt(
    long FamilyId,
    string? FamilyName,
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
