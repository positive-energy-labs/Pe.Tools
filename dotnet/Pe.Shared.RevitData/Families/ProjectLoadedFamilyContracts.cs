using Pe.Shared.RevitData;

namespace Pe.Shared.RevitData.Families;

public sealed record ProjectLoadedFamilyType(
    long TypeId,
    string TypeUniqueId,
    string TypeName
);

public enum ProjectLoadedFamilyIssueSeverity {
    Info,
    Warning,
    Error
}

public sealed record ProjectLoadedFamilyIssue(
    string Code,
    ProjectLoadedFamilyIssueSeverity Severity,
    string Message,
    string? FamilyName,
    string? TypeName,
    string? ParameterName
);

public sealed record ProjectLoadedFamilyParameter {
    public required ParameterDefinitionDescriptor Definition { get; init; }
    public RequestedParameterStorageType StorageType { get; init; }
    public List<string> TypeNames { get; init; } = [];
    public Dictionary<string, string?> ValuesByType { get; init; } = new(StringComparer.Ordinal);

    public ParameterIdentity Identity => this.Definition.Identity;
    public bool? IsInstance => this.Definition.IsInstance;
}

public sealed record ProjectLoadedFamilyRecord {
    public long FamilyId { get; init; }
    public string FamilyUniqueId { get; init; } = string.Empty;
    public string FamilyName { get; init; } = string.Empty;
    public string? CategoryName { get; init; }
    public int PlacedInstanceCount { get; init; }
    public List<ProjectLoadedFamilyType> Types { get; set; } = [];
    public List<ProjectLoadedFamilyParameter> Parameters { get; set; } = [];
    public List<ProjectLoadedFamilyIssue> Issues { get; } = [];

    internal Dictionary<string, ProjectLoadedFamilyParameter> ParametersByKey { get; } =
        new(StringComparer.Ordinal);
}

public sealed record ProjectParameterCatalogEntry {
    public required ParameterDefinitionDescriptor Definition { get; init; }
    public RequestedParameterStorageType StorageType { get; init; }
    public HashSet<string> FamilyNames { get; init; } = new(StringComparer.OrdinalIgnoreCase);
    public Dictionary<string, string?> ValuesPerType { get; init; } = new(StringComparer.Ordinal);

    public ParameterIdentity Identity => this.Definition.Identity;
    public bool? IsInstance => this.Definition.IsInstance;
}