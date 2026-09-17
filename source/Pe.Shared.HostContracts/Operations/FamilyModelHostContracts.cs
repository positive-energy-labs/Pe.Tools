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

public sealed record FamilyModelBuildRequest(
    string ModelJson,
    string OutputPath,
    string? ModelDirectory = null,
    bool Overwrite = false
);

public sealed record FamilyModelBuildData(
    Reading Reading,
    string FamilyName,
    string OutputPath,
    string TemplatePath,
    bool Converged,
    int ResidueCount
);
