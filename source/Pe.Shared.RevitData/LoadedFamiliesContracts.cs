using Newtonsoft.Json;
using Newtonsoft.Json.Converters;

namespace Pe.Shared.RevitData;

[JsonConverter(typeof(StringEnumConverter))]
public enum LoadedFamilyPlacementScope {
    AllLoaded,
    PlacedOnly,
    UnplacedOnly
}

[JsonConverter(typeof(StringEnumConverter))]
public enum FormulaState {
    None,
    Present,
    NotApplicable,
    Unknown
}

[JsonConverter(typeof(StringEnumConverter))]
public enum LoadedFamilyParameterKind {
    Unknown,
    FamilyParameter,
    SharedParameter,
    ProjectParameter,
    ProjectSharedParameter
}

[JsonConverter(typeof(StringEnumConverter))]
public enum LoadedFamilyParameterPresence {
    Unresolved,
    Family,
    FamilyAndProjectBinding,
    ProjectBindingOnly
}

[JsonConverter(typeof(StringEnumConverter))]
public enum ExcludedParameterReason {
    UnresolvedClassification,
    ProjectObservedBuiltIn
}

public record LoadedFamiliesFilterFieldOptionsRequest(
    string PropertyPath,
    string SourceKey,
    Dictionary<string, string>? ContextValues
);

public record LoadedFamiliesCatalogRequest(
    LoadedFamiliesFilter? Filter,
    RevitDataProjectionRequest? Projection = null,
    RevitDataOutputBudget? Budget = null
);

public record LoadedFamiliesMatrixRequest(
    LoadedFamiliesFilter? Filter,
    RevitDataOutputBudget? Budget = null,
    // Temp placement supplies live instance values, regen-dependent values, and schedule membership for
    // unplaced types, at the cost of a rollback transaction on the document. Disable for a read-only pass.
    bool IncludeTempPlacement = true
);

public record LoadedFamiliesFilter {
    public List<string> FamilyNames { get; init; } = [];
    public string? FamilyNameContains { get; init; }
    public List<string> CategoryNames { get; init; } = [];
    public string? CategoryNameContains { get; init; }
    public LoadedFamilyPlacementScope PlacementScope { get; init; } = LoadedFamilyPlacementScope.AllLoaded;
}

public record LoadedFamilyTypeEntry(
    string TypeName
);

public record LoadedFamilyCatalogEntry(
    long FamilyId,
    string FamilyUniqueId,
    string FamilyName,
    string? CategoryName,
    int TypeCount,
    int PlacedInstanceCount,
    List<LoadedFamilyTypeEntry> Types
);

public record LoadedFamiliesCatalogSummary(
    int TotalFamilies,
    int PlacedFamilies,
    int UnplacedFamilies,
    int TotalTypes,
    int TotalPlacedInstances,
    bool Truncated
);

public record LoadedFamiliesCatalogData(
    LoadedFamiliesCatalogSummary Summary,
    List<LoadedFamilyCatalogEntry> Families,
    List<RevitDataIssue> Issues,
    RevitDataResultPage? Page = null
);

// The matrix speaks the canonical family record language (FamilySnapshotContracts): one parameter list
// where excluded entries carry ExcludedReason, `scope` replaces the old `presence`, and per-type values
// live in ValuesPerType. UIs and agents consume FamilySnapshotRecord directly.
public record LoadedFamiliesMatrixData(
    List<Families.FamilySnapshotRecord> Families,
    List<RevitDataIssue> Issues,
    RevitDataResultPage? Page = null
);
