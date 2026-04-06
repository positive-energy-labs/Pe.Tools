using Newtonsoft.Json;
using Newtonsoft.Json.Converters;
using Pe.Host.Contracts.Operations;
using Pe.Host.Contracts.SettingsStorage;
using TypeGen.Core.TypeAnnotations;

namespace Pe.Host.Contracts.RevitData;

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
public enum LoadedFamilyParameterScope {
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
public record LoadedFamiliesFilter {
    public List<string> FamilyNames { get; init; } = [];
    public List<string> CategoryNames { get; init; } = [];
    public LoadedFamilyPlacementScope PlacementScope { get; init; } = LoadedFamilyPlacementScope.AllLoaded;
}

[ExportTsInterface]
public record LoadedFamiliesFilterFieldOptionsRequest(
    string PropertyPath,
    string SourceKey,
    Dictionary<string, string>? ContextValues
);

[ExportTsInterface]
public record LoadedFamiliesCatalogRequest(
    LoadedFamiliesFilter? Filter
);

[ExportTsInterface]
public record LoadedFamiliesMatrixRequest(
    LoadedFamiliesFilter? Filter
);

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
public record LoadedFamiliesCatalogData(
    List<LoadedFamilyCatalogEntry> Families,
    List<RevitDataIssue> Issues
);

[ExportTsInterface]
public record LoadedFamilyVisibleParameterEntry(
    ParameterIdentity Identity,
    bool IsInstance,
    LoadedFamilyParameterKind Kind,
    LoadedFamilyParameterScope Scope,
    string StorageType,
    string? DataTypeId,
    string? DataTypeLabel,
    string? GroupTypeId,
    string? GroupTypeLabel,
    FormulaState FormulaState,
    string? Formula,
    Dictionary<string, string?> ValuesByType
);

[ExportTsInterface]
public record LoadedFamilyExcludedParameterEntry(
    ParameterIdentity Identity,
    bool IsInstance,
    LoadedFamilyParameterKind Kind,
    LoadedFamilyParameterScope Scope,
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
    List<RevitDataIssue> Issues
);

[ExportTsInterface]
public record LoadedFamiliesCatalogEnvelopeResponse(
    bool Ok,
    EnvelopeCode Code,
    string Message,
    List<ValidationIssue> Issues,
    LoadedFamiliesCatalogData? Data
) : IHostDataEnvelope<LoadedFamiliesCatalogData> {
    public object? GetData() => this.Data;
}

[ExportTsInterface]
public record LoadedFamiliesMatrixEnvelopeResponse(
    bool Ok,
    EnvelopeCode Code,
    string Message,
    List<ValidationIssue> Issues,
    LoadedFamiliesMatrixData? Data
) : IHostDataEnvelope<LoadedFamiliesMatrixData> {
    public object? GetData() => this.Data;
}