using Newtonsoft.Json;
using Newtonsoft.Json.Converters;
using System.Runtime.Serialization;

namespace Pe.Shared.RevitData;

[JsonConverter(typeof(StringEnumConverter))]
public enum ParameterLinkRelationship {
    [EnumMember(Value = "sameElement")]
    SameElement,
    [EnumMember(Value = "electricalEquipmentCircuits")]
    ElectricalEquipmentCircuits
}

[JsonConverter(typeof(StringEnumConverter))]
public enum ParameterLinkReducer {
    [EnumMember(Value = "first")]
    First,
    [EnumMember(Value = "min")]
    Min,
    [EnumMember(Value = "max")]
    Max
}

[JsonConverter(typeof(StringEnumConverter))]
public enum ParameterLinkSourceScope {
    [EnumMember(Value = "instance")]
    Instance,
    [EnumMember(Value = "type")]
    Type,
    [EnumMember(Value = "instanceThenType")]
    InstanceThenType
}

[JsonConverter(typeof(StringEnumConverter))]
public enum ParameterLinkIssueSeverity {
    [EnumMember(Value = "warning")]
    Warning,
    [EnumMember(Value = "error")]
    Error
}

public sealed record ParameterLinkProfile {
    public const int CurrentFormatVersion = 1;

    public int FormatVersion { get; init; } = CurrentFormatVersion;
    [JsonProperty(Required = Required.Always)]
    public List<ParameterLinkDefinition> Definitions { get; init; } = [];
    [JsonProperty(Required = Required.Always)]
    public List<ParameterLinkAssignment> Assignments { get; init; } = [];
}

public sealed record ParameterLinkDefinition {
    [JsonProperty(Required = Required.Always)]
    public required string Id { get; init; }
    [JsonProperty(Required = Required.Always)]
    public required int SourceCategoryId { get; init; }
    [JsonProperty(Required = Required.Always)]
    public required ParameterReference SourceParameter { get; init; }
    public ParameterLinkSourceScope SourceScope { get; init; } = ParameterLinkSourceScope.InstanceThenType;
    [JsonProperty(Required = Required.Always)]
    public required ParameterLinkRelationship Relationship { get; init; }
    [JsonProperty(Required = Required.Always)]
    public required ParameterReference TargetParameter { get; init; }
    public ParameterLinkTargetOverride? TargetOverride { get; init; }
    public ParameterLinkReducer Reducer { get; init; } = ParameterLinkReducer.First;
}

public sealed record ParameterLinkTargetOverride {
    [JsonProperty(Required = Required.Always)]
    public required ParameterReference EnabledParameter { get; init; }
    [JsonProperty(Required = Required.Always)]
    public required ParameterReference ValueParameter { get; init; }
}

public sealed record ParameterLinkAssignment {
    [JsonProperty(Required = Required.Always)]
    public required string Id { get; init; }
    [JsonProperty(Required = Required.Always)]
    public required string DefinitionId { get; init; }
    public bool Enabled { get; init; } = true;
    public List<string> SourceElementUniqueIds { get; init; } = [];
}

public sealed record ParameterLinkValue {
    public required string StorageType { get; init; }
    public string? SpecTypeId { get; init; }
    public double? DoubleValue { get; init; }
    public int? IntegerValue { get; init; }
    public string? StringValue { get; init; }
    public long? ElementIdValue { get; init; }
    public string? DisplayValue { get; init; }
}

public sealed record ParameterLinkWrite {
    public required string DefinitionId { get; init; }
    public required string AssignmentId { get; init; }
    public required long TargetElementId { get; init; }
    public required string TargetElementUniqueId { get; init; }
    public string? TargetElementName { get; init; }
    public required ParameterIdentity TargetParameter { get; init; }
    public required ParameterLinkValue CurrentValue { get; init; }
    public required ParameterLinkValue LinkedValue { get; init; }
    public ParameterLinkValue? OverrideValue { get; init; }
    public required bool OverrideApplied { get; init; }
    public required ParameterLinkValue ProposedValue { get; init; }
    public required bool Changed { get; init; }
}

public sealed record ParameterLinkIssue {
    public required string Code { get; init; }
    public required ParameterLinkIssueSeverity Severity { get; init; }
    public required string Message { get; init; }
    public string? DefinitionId { get; init; }
    public string? AssignmentId { get; init; }
    public string? SourceElementUniqueId { get; init; }
    public string? TargetElementUniqueId { get; init; }
}

public sealed record ParameterLinkEvaluation {
    public List<ParameterLinkWrite> Writes { get; init; } = [];
    public List<ParameterLinkIssue> Issues { get; init; } = [];
    public int SourceElementCount { get; init; }
    public int TargetElementCount { get; init; }
    public int ChangedWriteCount { get; init; }
}

public sealed record ParameterLinksRuntimeStatus(
    bool HasStoredProfile,
    bool UpdaterRegistered,
    int ActiveDefinitionCount,
    int ActiveAssignmentCount
);

public sealed record ParameterLinksDetailRequest(bool IncludeEvaluation = true);

public sealed record ParameterLinksApplyRequest(
    ParameterLinkProfile? Profile = null,
    bool PreviewOnly = false,
    bool Reconcile = true
);

public sealed record ParameterLinksData(
    ParameterLinkProfile? Profile,
    ParameterLinkEvaluation? Evaluation,
    ParameterLinksRuntimeStatus Status,
    bool ProfileChanged,
    int AppliedWriteCount
);
