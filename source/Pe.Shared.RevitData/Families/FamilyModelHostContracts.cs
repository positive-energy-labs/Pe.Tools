namespace Pe.Shared.RevitData.Families;

public sealed record FamilyModelCaptureRequest;

public sealed record FamilyModelCaptureData(
    string FamilyName,
    string ModelJson,
    int UnmodeledCount
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
    string TemplatePath
);
