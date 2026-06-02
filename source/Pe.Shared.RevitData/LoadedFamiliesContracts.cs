using Newtonsoft.Json;
using Newtonsoft.Json.Converters;
using TypeGen.Core.TypeAnnotations;

namespace Pe.Shared.RevitData;

[JsonConverter(typeof(StringEnumConverter))]
[ExportTsEnum]
public enum LoadedFamilyPlacementScope {
    AllLoaded,
    PlacedOnly,
    UnplacedOnly
}

[JsonConverter(typeof(StringEnumConverter))]
[ExportTsEnum]
public enum FormulaState {
    None,
    Present,
    NotApplicable,
    Unknown
}

[JsonConverter(typeof(StringEnumConverter))]
[ExportTsEnum]
public enum LoadedFamilyParameterKind {
    Unknown,
    FamilyParameter,
    SharedParameter,
    ProjectParameter,
    ProjectSharedParameter
}

[JsonConverter(typeof(StringEnumConverter))]
[ExportTsEnum]
public enum LoadedFamilyParameterPresence {
    Unresolved,
    Family,
    FamilyAndProjectBinding,
    ProjectBindingOnly
}

[JsonConverter(typeof(StringEnumConverter))]
[ExportTsEnum]
public enum ExcludedParameterReason {
    UnresolvedClassification,
    ProjectObservedBuiltIn
}

[ExportTsInterface]
public record LoadedFamiliesFilterFieldOptionsRequest(
    string PropertyPath,
    string SourceKey,
    Dictionary<string, string>? ContextValues
);

[ExportTsInterface]
public record LoadedFamiliesCatalogRequest(
    LoadedFamiliesFilter? Filter,
    RevitDataProjectionRequest? Projection = null,
    RevitDataOutputBudget? Budget = null
);

[ExportTsInterface]
public record LoadedFamiliesMatrixRequest(
    LoadedFamiliesFilter? Filter,
    RevitDataOutputBudget? Budget = null
);

[ExportTsInterface]
public record LoadedFamiliesFilter {
    public List<string> FamilyNames { get; init; } = [];
    public string? FamilyNameContains { get; init; }
    public List<string> CategoryNames { get; init; } = [];
    public string? CategoryNameContains { get; init; }
    public LoadedFamilyPlacementScope PlacementScope { get; init; } = LoadedFamilyPlacementScope.AllLoaded;
}

[ExportTsInterface]
public record LoadedFamilyTypeEntry(
    string TypeName
);

[ExportTsInterface]
public record LoadedFamilyCatalogEntry(
    long FamilyId,
    string FamilyUniqueId,
    string FamilyName,
    string? CategoryName,
    int TypeCount,
    int PlacedInstanceCount,
    List<LoadedFamilyTypeEntry> Types
);

[ExportTsInterface]
public record LoadedFamiliesCatalogSummary(
    int TotalFamilies,
    int PlacedFamilies,
    int UnplacedFamilies,
    int TotalTypes,
    int TotalPlacedInstances,
    bool Truncated
);

[ExportTsInterface]
public record LoadedFamiliesCatalogData(
    LoadedFamiliesCatalogSummary Summary,
    List<LoadedFamilyCatalogEntry> Families,
    List<RevitDataIssue> Issues,
    RevitDataResultPage? Page = null
);

[ExportTsInterface]
public record LoadedFamilyVisibleParameterEntry(
    ParameterDefinitionDescriptor Definition,
    LoadedFamilyParameterKind Kind,
    LoadedFamilyParameterPresence Presence,
    string StorageType,
    FormulaState FormulaState,
    string? Formula,
    Dictionary<string, string?> ValuesByType
);

[ExportTsInterface]
public record LoadedFamilyExcludedParameterEntry(
    ParameterDefinitionDescriptor Definition,
    LoadedFamilyParameterKind Kind,
    LoadedFamilyParameterPresence Presence,
    ExcludedParameterReason ExcludedReason,
    FormulaState FormulaState,
    string? Formula
);

[ExportTsInterface]
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

[ExportTsInterface]
public record LoadedFamiliesMatrixData(
    List<LoadedFamilyMatrixFamily> Families,
    List<RevitDataIssue> Issues,
    RevitDataResultPage? Page = null
);
