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
    string TemplatePath
);

public static class FamilyModelHostOperations {
    public const string CaptureKey = "revit.detail.family-model";
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
