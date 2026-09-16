using Pe.Shared.RevitData.Families;
using Pe.Shared.RevitData;

namespace Pe.Shared.HostContracts.Operations;

/// <summary>Diagnostic for the Family Foundry host operations: a closed code, a JSON path, a message, an optional fix.</summary>
public sealed record FamilyFoundryDiagnostic(string Code, string Path, string Message, string? Suggestion = null);

/// <summary>Plan a patch (`{ select, patch, run }` JSON) against the loaded families it selects, one explicit family, or the current family document. In a family document FamilyId is OwnerFamily.Id; a mismatching id is refused.</summary>
public sealed record FamilyFoundryPlanRequest(string PatchJson, long? FamilyId = null, ExecutionOptions? ExecutionOptions = null);

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

/// <summary>Apply the patch to explicit families; each family's `expectedPlanHash` from the plan call gates drift. In a family document only OwnerFamily.Id is accepted; the existing document is not saved.</summary>
public sealed record FamilyFoundryApplyRequest(string PatchJson, IReadOnlyDictionary<long, string> ExpectedPlanHashes, ExecutionOptions? ExecutionOptions = null);

/// <summary>The receipt: outcomes per change, residue after re-capture, converged = residue 0 and no errors.</summary>
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
    string? ObservedParametersDigest = null
);

public sealed record FamilyFoundryApplyData(
    IReadOnlyList<FamilyFoundryApplyReceipt> Receipts,
    IReadOnlyList<FamilyFoundryDiagnostic> Diagnostics
);

/// <summary>Capture loaded families read-only as family.json.</summary>
public sealed record FamilyFoundryProjectRequest(IReadOnlyList<long> FamilyIds);

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

public sealed record FamilyFoundryProjectData(
    IReadOnlyList<FamilyFoundryFamilyModelData> Families,
    IReadOnlyList<FamilyFoundryDiagnostic> Diagnostics
);
