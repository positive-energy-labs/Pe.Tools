using Newtonsoft.Json;
using Newtonsoft.Json.Converters;
using Pe.Shared.Codegen;

namespace Pe.Shared.RevitData;

[JsonConverter(typeof(StringEnumConverter))]
[ExportTsSchema]
public enum ProjectParameterBindingKind {
    Instance,
    Type
}

[ExportTsSchema]
public record ProjectParameterBindingsRequest(
    LoadedFamiliesFilter? Filter = null,
    ProjectParameterBindingsFilter? BindingFilter = null,
    RevitDataProjectionRequest? Projection = null,
    RevitDataOutputBudget? Budget = null
);

[ExportTsSchema]
public record ProjectParameterBindingsFilter {
    public List<ParameterReference> Parameters { get; init; } = [];
    public string? ParameterNameContains { get; init; }
    public List<string> CategoryNames { get; init; } = [];
    public ProjectParameterBindingKind? BindingKind { get; init; }
}

[ExportTsSchema]
public record ProjectParameterBindingEntry(
    ParameterDefinitionDescriptor Definition,
    ProjectParameterBindingKind BindingKind,
    List<string> CategoryNames
);

[ExportTsSchema]
public record ProjectParameterBindingsSummary(
    int TotalBindings,
    int InstanceBindings,
    int TypeBindings,
    Dictionary<string, int> BindingsByCategory,
    bool Truncated
);

[ExportTsSchema]
public record ProjectParameterBindingsData(
    ProjectParameterBindingsSummary Summary,
    List<ProjectParameterBindingEntry> Entries,
    List<RevitDataIssue> Issues,
    RevitDataResultPage? Page = null
);
