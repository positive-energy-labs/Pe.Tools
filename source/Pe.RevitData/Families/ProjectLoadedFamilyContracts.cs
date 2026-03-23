using Pe.RevitData.Parameters;

namespace Pe.RevitData.Families;

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
    public required RevitParameterIdentity Identity { get; init; }
    public bool IsInstance { get; init; }
    public ForgeTypeId PropertiesGroup { get; init; } = new("");
    public ForgeTypeId DataType { get; init; } = SpecTypeId.String.Text;
    public StorageType StorageType { get; init; }
    public List<string> TypeNames { get; init; } = [];
    public Dictionary<string, string?> ValuesByType { get; init; } = new(StringComparer.Ordinal);
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
    public required RevitParameterIdentity Identity { get; init; }
    public bool IsInstance { get; init; }
    public ForgeTypeId PropertiesGroup { get; init; } = new("");
    public ForgeTypeId DataType { get; init; } = SpecTypeId.String.Text;
    public StorageType StorageType { get; init; }
    public HashSet<string> FamilyNames { get; init; } = new(StringComparer.OrdinalIgnoreCase);
    public Dictionary<string, string?> ValuesPerType { get; init; } = new(StringComparer.Ordinal);
}
