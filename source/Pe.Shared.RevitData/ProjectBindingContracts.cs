using Newtonsoft.Json;
using Newtonsoft.Json.Converters;

namespace Pe.Shared.RevitData;

[JsonConverter(typeof(StringEnumConverter))]
public enum ProjectParameterBindingKind {
    Instance,
    Type
}

public record ProjectParameterBindingsRequest(
    LoadedFamiliesFilter? Filter = null,
    ProjectParameterBindingsFilter? BindingFilter = null,
    RevitDataProjectionRequest? Projection = null,
    RevitDataOutputBudget? Budget = null
);

public record ProjectParameterBindingsFilter {
    public List<ParameterReference> Parameters { get; init; } = [];
    public string? ParameterNameContains { get; init; }
    public List<string> CategoryNames { get; init; } = [];
    public ProjectParameterBindingKind? BindingKind { get; init; }
}

public record ProjectParameterBindingEntry(
    ParameterDefinitionDescriptor Definition,
    ProjectParameterBindingKind BindingKind,
    List<string> CategoryNames
);

public record ProjectParameterBindingsSummary(
    int TotalBindings,
    int InstanceBindings,
    int TypeBindings,
    Dictionary<string, int> BindingsByCategory,
    bool Truncated
);

public record ProjectParameterBindingsData(
    ProjectParameterBindingsSummary Summary,
    List<ProjectParameterBindingEntry> Entries,
    List<RevitDataIssue> Issues,
    RevitDataResultPage? Page = null
);
