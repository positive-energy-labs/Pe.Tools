using Pe.Shared.RevitData;

namespace Pe.Shared.HostContracts.Operations;

public sealed record FamilyCaptureRequest;

public sealed record FamilyCaptureData(
    string ObservedAt,
    string FamilyName,
    string ModelJson,
    int UnmodeledCount,
    IReadOnlyDictionary<string, string> Coverage,
    IReadOnlyList<RevitDataIssue> Issues
);

/// <summary>
///     Build a new family from a saved family model spec on its header's template; nested models resolve
///     from `modelDirectory`. There is no output path: every build lands in a fresh run folder in the source
///     pod beside its receipt (user verdict, 2026-09-17), so nothing overwrites and nothing escapes the pod.
/// </summary>
public sealed record FamilyBuildRequest(
    string SpecJson,
    PodComposedSource Source,
    string? ModelDirectory = null
);

public sealed record FamilyBuildData(
    Reading Reading,
    string FamilyName,

    /// <summary>The built `.rfa`, inside this build's run folder.</summary>
    string OutputPath,
    string TemplatePath,
    bool Converged,
    int ResidueCount,

    /// <summary>`null` when the family was built but its run output could not be saved; `outputError` names why.</summary>
    string? ReceiptPath,
    string? OutputError = null
);
