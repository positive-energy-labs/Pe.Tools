using Pe.Shared.RevitData.Families;

namespace Pe.Shared.HostContracts.Operations;

public sealed record FamilyModelCaptureRequest;

public sealed record FamilyModelCaptureData(
    string FamilyName,
    string ModelJson,
    int UnmodeledCount,
    FamilyModelEvidence Evidence
);

public sealed record FamilyModelBuildRequest(
    string ModelJson,
    string OutputPath,
    string? ModelDirectory = null,
    bool Overwrite = false
);

public sealed record FamilyModelBuildData(
    string FamilyName,
    string OutputPath,
    string TemplatePath,
    FamilyModelEvidence Evidence
);
