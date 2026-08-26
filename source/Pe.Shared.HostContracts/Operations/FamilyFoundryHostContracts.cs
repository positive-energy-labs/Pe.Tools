using Newtonsoft.Json;
using Newtonsoft.Json.Converters;
using Newtonsoft.Json.Linq;
using Newtonsoft.Json.Serialization;
using Pe.Shared.RevitData;
using System.Globalization;
using System.Security.Cryptography;
using System.Text;

namespace Pe.Shared.HostContracts.Operations;

public sealed record FamilyFoundryDiagnostic(
    string Code,
    string Path,
    string Message,
    string? Suggestion = null
);

public sealed record FamilyFoundryPlanRequest(
    string ProfileJson,
    long? FamilyId = null
);

public sealed record FamilyFoundryPlanData(
    Reading Reading,
    string? PlanHash,
    IReadOnlyList<FamilyFoundryFamilyPlanData> Families,
    IReadOnlyList<FamilyFoundryDiagnostic> Diagnostics
);

public sealed record FamilyFoundryFamilyPlanData(
    long FamilyId,
    string FamilyName,
    FamilyFoundryReconciliationPlanData Plan
);

public sealed record FamilyFoundryReconciliationPlanData(
    IReadOnlyList<FamilyFoundryResolvedParameterData> Parameters,
    IReadOnlyList<string> RequiredApsParameterNames,
    IReadOnlyList<string> FamilyParameterNames,
    IReadOnlyList<FamilyFoundryLoweredActionData> LoweredActions
);

public sealed record FamilyFoundryResolvedParameterData(
    FamilyFoundryResolvedParameterDefinitionData Definition,
    bool IsShared,
    FamilyFoundryAssignmentData? Assignment,
    IReadOnlyDictionary<string, string?> ValuesByType,
    FamilyFoundryMigrationData? Migration,
    FamilyFoundryParameterProvenanceData Provenance
);

public sealed record FamilyFoundryResolvedParameterDefinitionData(
    ParameterIdentity Identity,
    string Name,
    string DataTypeId,
    string PropertiesGroupId,
    bool IsInstance,
    string? Tooltip
);

public sealed record FamilyFoundryAssignmentData(string Kind, string Value);

public sealed record FamilyFoundryMigrationData(
    IReadOnlyList<string> SourceNames,
    bool OnlyAddIfSourceExists,
    string MappingStrategy
);

public sealed record FamilyFoundryParameterProvenanceData(
    string Identity,
    string DataType,
    string PropertiesGroup,
    string IsInstance,
    string Tooltip
);

public sealed record FamilyFoundryLoweredActionData(
    string Operation,
    string Target,
    IReadOnlyList<string> Sources,
    string Reason
);

public sealed record FamilyFoundryApplyRequest(
    string ProfileJson,
    IReadOnlyList<long> FamilyIds,
    string ExpectedPlanHash
);

public sealed record FamilyFoundryApplyData(
    string? PlanHash,
    bool Refused,
    IReadOnlyList<FamilyFoundryApplyReceipt> Receipts,
    IReadOnlyList<FamilyFoundryDiagnostic> Diagnostics
);

public sealed record FamilyFoundryApplyReceipt(
    long FamilyId,
    string? FamilyName,
    bool Success,
    string? Error,
    IReadOnlyList<string> OperationsRun,
    int ParametersChanged,
    FamilyFoundryParameterDiffSummary DiffSummary,
    string? ArtifactDirectoryPath
);

public sealed record FamilyFoundryParameterDiffSummary(
    int Added,
    int Removed,
    int Modified
);

public sealed record FamilyFoundryProjectRequest(IReadOnlyList<long> FamilyIds);

public sealed record FamilyFoundryProjectData(
    IReadOnlyList<FamilyFoundryProfileProjectionData> Projections,
    IReadOnlyList<FamilyFoundryDiagnostic> Diagnostics
);

public sealed record FamilyFoundryProfileProjectionData(
    long FamilyId,
    string? FamilyName,
    bool Success,
    string? ProfileJson,
    string? Error
);

public static class FamilyFoundryPlanHasher {
    private static readonly JsonSerializerSettings StableSettings = new() {
        ContractResolver = new DefaultContractResolver {
            NamingStrategy = new CamelCaseNamingStrategy()
        },
        Converters = [new StringEnumConverter()],
        Culture = CultureInfo.InvariantCulture,
        Formatting = Formatting.None,
        NullValueHandling = NullValueHandling.Include
    };

    public static string Compute(FamilyFoundryReconciliationPlanData plan) {
        if (plan == null)
            throw new ArgumentNullException(nameof(plan));
        var token = JToken.FromObject(plan, JsonSerializer.Create(StableSettings));
        var json = Canonicalize(token).ToString(Formatting.None);
        using var sha256 = SHA256.Create();
        var bytes = sha256.ComputeHash(Encoding.UTF8.GetBytes(json));
        return BitConverter.ToString(bytes).Replace("-", string.Empty).ToLowerInvariant();
    }

    private static JToken Canonicalize(JToken token) => token switch {
        JObject jsonObject => new JObject(jsonObject.Properties()
            .OrderBy(property => property.Name, StringComparer.Ordinal)
            .Select(property => new JProperty(property.Name, Canonicalize(property.Value)))),
        JArray jsonArray => new JArray(jsonArray.Select(Canonicalize)),
        _ => token.DeepClone()
    };
}

public static class FamilyFoundryHostOperations {
    public const string PlanKey = "familyfoundry.plan";
    public const string ApplyKey = "familyfoundry.apply";
    public const string ProjectKey = "familyfoundry.project";

    public static BridgeOp Plan(
        Func<FamilyFoundryPlanRequest, IBridgeOperationContext, CancellationToken, Task<FamilyFoundryPlanData>> handler
    ) => BridgeOp.Create(
        PlanKey,
        "Plan Family Foundry Migration",
        HostOperationAgentMetadata.Create(
            "Strictly compile inline desired-state Family Foundry profile JSON into per-family reconciliation plans with provenance and a deterministic drift hash.",
            ["family-foundry", "familyfoundry", "migration", "plan", "provenance", "plan-hash"],
            requiresActiveDocument: true,
            costTier: HostOperationCostTier.Bounded,
            supportedActiveDocumentKind: HostOperationActiveDocumentKind.ProjectOnly
        ),
        handler
    );

    public static BridgeOp Apply(
        Func<FamilyFoundryApplyRequest, IBridgeOperationContext, CancellationToken, Task<FamilyFoundryApplyData>> handler
    ) => BridgeOp.Create(
        ApplyKey,
        "Apply Family Foundry Migration",
        HostOperationAgentMetadata.Create(
            "Recompile inline desired-state Family Foundry profile JSON, refuse plan drift, then migrate each explicit loaded family independently with receipts.",
            ["family-foundry", "familyfoundry", "migration", "apply", "plan-hash", "receipts"],
            HostOperationIntent.Mutate,
            requiresActiveDocument: true,
            costTier: HostOperationCostTier.Mutation,
            supportedActiveDocumentKind: HostOperationActiveDocumentKind.ProjectOnly
        ),
        handler
    );

    public static BridgeOp Project(
        Func<FamilyFoundryProjectRequest, IBridgeOperationContext, CancellationToken, Task<FamilyFoundryProjectData>> handler
    ) => BridgeOp.Create(
        ProjectKey,
        "Project Family Foundry Profiles",
        HostOperationAgentMetadata.Create(
            "Open selected loaded families read-only, capture full snapshots, and return dense runnable FFManagerProfile JSON inline.",
            ["family-foundry", "familyfoundry", "project", "snapshot", "profile", "manager"],
            requiresActiveDocument: true,
            costTier: HostOperationCostTier.Expensive,
            supportedActiveDocumentKind: HostOperationActiveDocumentKind.ProjectOnly
        ),
        handler
    );
}
