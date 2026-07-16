namespace Pe.Shared.HostContracts.Operations;

public sealed record FamilyModelCaptureRequest;

public sealed record FamilyModelCaptureData(
    string FamilyName,
    string ModelJson,
    int UnmodeledCount
);

public sealed record FamilyModelValidateRequest(string ModelJson);

public sealed record FamilyModelValidationIssue(string Code, string Path, string Message);

public sealed record FamilyModelValidateData(
    bool Valid,
    IReadOnlyList<FamilyModelValidationIssue> Issues
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

public static class FamilyModelHostOperations {
    public const string CaptureKey = "revit.context.family-model";
    public const string ValidateKey = "revit.context.family-model.validation";
    public const string BuildKey = "revit.apply.family-model";

    public static BridgeOp Capture(
        Func<FamilyModelCaptureRequest, IBridgeOperationContext, CancellationToken, Task<FamilyModelCaptureData>> handler
    ) => BridgeOp.Create(
        CaptureKey,
        "Capture Family Model",
        HostOperationAgentMetadata.Create(
            "Capture the active Revit family document as portable family.json authored truth, including explicit unmodeled diagnostics.",
            ["family-model", "family-json", "capture", "roundtrip", "family-foundry"],
            requiresActiveDocument: true
        ),
        handler
    );

    public static BridgeOp Validate(
        Func<FamilyModelValidateRequest, IBridgeOperationContext, CancellationToken, Task<FamilyModelValidateData>> handler
    ) => BridgeOp.Create(
        ValidateKey,
        "Validate Family Model",
        HostOperationAgentMetadata.Create(
            "Validate family.json with the authoritative portable Family Model parser and return path-addressed diagnostics.",
            ["family-model", "family-json", "validate", "diagnostics", "family-foundry"],
            requiresActiveDocument: false
        ),
        handler
    );

    public static BridgeOp Build(
        Func<FamilyModelBuildRequest, IBridgeOperationContext, CancellationToken, Task<FamilyModelBuildData>> handler
    ) => BridgeOp.Create(
        BuildKey,
        "Build Family Model",
        HostOperationAgentMetadata.Create(
            "Build a new target-year Revit family from portable family.json and save it to an explicit .rfa output path.",
            ["family-model", "family-json", "build", "replay", "family-foundry", "manager"],
            HostOperationIntent.Mutate,
            requiresActiveDocument: false,
            costTier: HostOperationCostTier.Mutation
        ),
        handler
    );
}
