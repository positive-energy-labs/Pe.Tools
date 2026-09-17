using Pe.Shared.RevitData;

namespace Pe.Shared.HostContracts.Operations;

public sealed record FamilyCaptureRequest;

public sealed record FamilyCaptureData(
    Reading Reading,
    string FamilyName,
    string ModelJson,
    int UnmodeledCount,
    IReadOnlyDictionary<string, string> Coverage,
    IReadOnlyList<RevitDataIssue> Issues
);

/// <summary>Build a new family from a saved family model spec on its header's template; nested models resolve from `modelDirectory`.</summary>
public sealed record FamilyBuildRequest(
    string SpecJson,
    string OutputPath,
    PodMemberSource Source,
    string? ModelDirectory = null,
    bool Overwrite = false
);

public sealed record FamilyBuildData(
    Reading Reading,
    string FamilyName,
    string OutputPath,
    string TemplatePath,
    bool Converged,
    int ResidueCount,
    string ReceiptPath
);
