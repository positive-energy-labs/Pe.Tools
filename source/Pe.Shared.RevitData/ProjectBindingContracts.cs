using Newtonsoft.Json;
using Newtonsoft.Json.Converters;
using TypeGen.Core.TypeAnnotations;

namespace Pe.Shared.RevitData;

[JsonConverter(typeof(StringEnumConverter))]
[ExportTsEnum]
public enum ProjectParameterBindingKind {
    Instance,
    Type
}

[ExportTsInterface]
public record ProjectParameterBindingsRequest(
    LoadedFamiliesFilter? Filter = null,
    ProjectParameterBindingsFilter? BindingFilter = null,
    RevitDataProjectionRequest? Projection = null,
    RevitDataOutputBudget? Budget = null
);

[ExportTsInterface]
public record ProjectParameterBindingsFilter {
    public List<string> ParameterNames { get; init; } = [];
    public string? ParameterNameContains { get; init; }
    public List<string> CategoryNames { get; init; } = [];
    public List<Guid> SharedGuids { get; init; } = [];
    public ProjectParameterBindingKind? BindingKind { get; init; }
}

[ExportTsInterface]
public record ProjectParameterBindingEntry(
    ParameterIdentity Identity,
    ProjectParameterBindingKind BindingKind,
    string? DataTypeId,
    string? DataTypeLabel,
    string? GroupTypeId,
    string? GroupTypeLabel,
    List<string> CategoryNames
);

[ExportTsInterface]
public record ProjectParameterBindingsSummary(
    int TotalBindings,
    int InstanceBindings,
    int TypeBindings,
    Dictionary<string, int> BindingsByCategory,
    bool Truncated
);

[ExportTsInterface]
public record ProjectParameterBindingsData(
    ProjectParameterBindingsSummary Summary,
    List<ProjectParameterBindingEntry> Entries,
    List<RevitDataIssue> Issues,
    RevitDataResultPage? Page = null
);
