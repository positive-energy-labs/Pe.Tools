using Newtonsoft.Json;
using Newtonsoft.Json.Converters;
using Pe.Shared.Codegen;

namespace Pe.Shared.RevitData;

[JsonConverter(typeof(StringEnumConverter))]
[ExportTsSchema]
public enum LoadedFamilyPlacementScope {
    AllLoaded,
    PlacedOnly,
    UnplacedOnly
}

[JsonConverter(typeof(StringEnumConverter))]
[ExportTsSchema]
public enum FormulaState {
    None,
    Present,
    NotApplicable,
    Unknown
}

[JsonConverter(typeof(StringEnumConverter))]
[ExportTsSchema]
public enum LoadedFamilyParameterKind {
    Unknown,
    FamilyParameter,
    SharedParameter,
    ProjectParameter,
    ProjectSharedParameter
}

[JsonConverter(typeof(StringEnumConverter))]
[ExportTsSchema]
public enum LoadedFamilyParameterPresence {
    Unresolved,
    Family,
    FamilyAndProjectBinding,
    ProjectBindingOnly
}

[JsonConverter(typeof(StringEnumConverter))]
[ExportTsSchema]
public enum ExcludedParameterReason {
    UnresolvedClassification,
    ProjectObservedBuiltIn
}

[ExportTsSchema]
public record LoadedFamiliesFilterFieldOptionsRequest(
    string PropertyPath,
    string SourceKey,
    Dictionary<string, string>? ContextValues
);

[ExportTsSchema]
public record LoadedFamiliesCatalogRequest(
    LoadedFamiliesFilter? Filter,
    RevitDataProjectionRequest? Projection = null,
    RevitDataOutputBudget? Budget = null
);

[ExportTsSchema]
public record LoadedFamiliesMatrixRequest(
    LoadedFamiliesFilter? Filter,
    RevitDataOutputBudget? Budget = null,
    // Temp placement supplies live instance values, regen-dependent values, and schedule membership for
    // unplaced types, at the cost of a rollback transaction on the document. Disable for a read-only pass.
    bool IncludeTempPlacement = true
);

[ExportTsSchema]
public record LoadedFamiliesFilter {
    public List<string> FamilyNames { get; init; } = [];
    public string? FamilyNameContains { get; init; }
    public List<string> CategoryNames { get; init; } = [];
    public string? CategoryNameContains { get; init; }
    public LoadedFamilyPlacementScope PlacementScope { get; init; } = LoadedFamilyPlacementScope.AllLoaded;
}

[ExportTsSchema]
public record LoadedFamilyTypeEntry(
    string TypeName
);

[ExportTsSchema]
public record LoadedFamilyCatalogEntry(
    long FamilyId,
    string FamilyUniqueId,
    string FamilyName,
    string? CategoryName,
    int TypeCount,
    int PlacedInstanceCount,
    List<LoadedFamilyTypeEntry> Types
);

[ExportTsSchema]
public record LoadedFamiliesCatalogSummary(
    int TotalFamilies,
    int PlacedFamilies,
    int UnplacedFamilies,
    int TotalTypes,
    int TotalPlacedInstances,
    bool Truncated
);

[ExportTsSchema]
public record LoadedFamiliesCatalogData(
    LoadedFamiliesCatalogSummary Summary,
    List<LoadedFamilyCatalogEntry> Families,
    List<RevitDataIssue> Issues,
    RevitDataResultPage? Page = null
);

[ExportTsSchema]
public record LoadedFamilyVisibleParameterEntry(
    ParameterDefinitionDescriptor Definition,
    LoadedFamilyParameterKind Kind,
    LoadedFamilyParameterPresence Presence,
    string StorageType,
    FormulaState FormulaState,
    string? Formula,
    Dictionary<string, string?> ValuesByType
);

[ExportTsSchema]
public record LoadedFamilyExcludedParameterEntry(
    ParameterDefinitionDescriptor Definition,
    LoadedFamilyParameterKind Kind,
    LoadedFamilyParameterPresence Presence,
    ExcludedParameterReason ExcludedReason,
    FormulaState FormulaState,
    string? Formula
);

[ExportTsSchema]
public record LoadedFamilyMatrixFamily(
    long FamilyId,
    string FamilyUniqueId,
    string FamilyName,
    string? CategoryName,
    int PlacedInstanceCount,
    List<LoadedFamilyTypeEntry> Types,
    List<string> ScheduleNames,
    List<LoadedFamilyVisibleParameterEntry> VisibleParameters,
    List<LoadedFamilyExcludedParameterEntry> ExcludedParameters,
    List<RevitDataIssue> Issues
);

[ExportTsSchema]
public record LoadedFamiliesMatrixData(
    List<LoadedFamilyMatrixFamily> Families,
    List<RevitDataIssue> Issues,
    RevitDataResultPage? Page = null
);
