using Pe.Shared.RevitData;

namespace Pe.Shared.HostContracts.Operations;

public sealed record FamilyModelCaptureRequest;

public sealed record FamilyModelCaptureData(
    Reading Reading,
    string FamilyName,
    string ModelJson,
    int UnmodeledCount,
    IReadOnlyDictionary<string, string> Coverage
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
