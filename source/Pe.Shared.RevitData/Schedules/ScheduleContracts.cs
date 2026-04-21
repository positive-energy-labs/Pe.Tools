using Newtonsoft.Json;
using Newtonsoft.Json.Converters;
using TypeGen.Core.TypeAnnotations;

namespace Pe.Shared.RevitData.Schedules;

[JsonConverter(typeof(StringEnumConverter))]
[ExportTsEnum]
public enum ScheduleProfilesQueryKind {
    CurrentActiveView,
    ScheduleReferences,
    ScheduleNames
}

[JsonConverter(typeof(StringEnumConverter))]
[ExportTsEnum]
public enum ScheduleQueryKind {
    CurrentActiveView,
    ScheduleReferences,
    ScheduleNames
}

[JsonConverter(typeof(StringEnumConverter))]
[ExportTsEnum]
public enum ScheduleCustomParameterMatchKind {
    Equals
}

[ExportTsInterface]
public record ScheduleCustomParameterFilter(
    string ParameterName,
    string ExpectedValue,
    ScheduleCustomParameterMatchKind MatchKind
);

[ExportTsInterface]
public record ScheduleCatalogRequest {
    public List<string> CategoryNames { get; init; } = [];
    public List<string> ScheduleNames { get; init; } = [];
    public List<ScheduleCustomParameterFilter> CustomParameterFilters { get; init; } = [];
    public bool IncludeTemplates { get; init; }
}

[ExportTsInterface]
public record ScheduleOnFinishSettings(
    bool OpenScheduleOnFinish
);

[ExportTsInterface]
public record ScheduleTitleBorderSpec(
    string? TopLineStyleName,
    string? BottomLineStyleName,
    string? LeftLineStyleName,
    string? RightLineStyleName
);

[ExportTsInterface]
public record ScheduleTitleStyleSpec(
    string HorizontalAlignment,
    ScheduleTitleBorderSpec BorderStyle
);

[ExportTsInterface]
public record ScheduleFieldFormatSpec(
    string? UnitTypeId,
    string? SymbolTypeId,
    double? Accuracy,
    bool SuppressTrailingZeros,
    bool SuppressLeadingZeros,
    bool UsePlusPrefix,
    bool UseDigitGrouping,
    bool SuppressSpaces
);

[ExportTsInterface]
public record CombinedParameterSpec(
    string ParameterName,
    string Prefix,
    string Suffix,
    string Separator
);

[ExportTsInterface]
public record ScheduleFieldSpec(
    string ParameterName,
    string ColumnHeaderOverride,
    string HeaderGroup,
    bool IsHidden,
    string DisplayType,
    double? ColumnWidth,
    string HorizontalAlignment,
    string? CalculatedType,
    string PercentageOfField,
    ScheduleFieldFormatSpec? FormatOptions,
    List<CombinedParameterSpec>? CombinedParameters
);

[ExportTsInterface]
public record ScheduleSortGroupSpec(
    string FieldName,
    string SortOrder,
    bool ShowHeader,
    bool ShowFooter,
    bool ShowBlankLine
);

[ExportTsInterface]
public record ScheduleFilterSpec(
    string FieldName,
    string FilterType,
    string Value
);

[ExportTsInterface]
public record ScheduleProfile(
    string Name,
    string CategoryName,
    string? ViewTemplateName,
    ScheduleTitleStyleSpec TitleStyle,
    bool IsItemized,
    bool FilterBySheet,
    List<ScheduleFieldSpec> Fields,
    List<ScheduleSortGroupSpec> SortGroup,
    List<ScheduleFilterSpec> Filters,
    ScheduleOnFinishSettings? OnFinishSettings
);

[ExportTsInterface]
public record ScheduleCatalogSheetPlacement(
    string SheetNumber,
    string SheetName
);

[ExportTsInterface]
public record ScheduleCatalogCustomParameterValue(
    string Name,
    string? Value,
    string? DisplayValue,
    RequestedParameterStorageType StorageType
);

[ExportTsInterface]
public record ScheduleVisibleFamilyEntry(
    long FamilyId,
    string FamilyName,
    string? CategoryName,
    int VisibleInstanceCount
);

[ExportTsInterface]
public record ScheduleParameterUsageEntry(
    string FieldName,
    string ColumnHeading,
    string Key
);

[ExportTsInterface]
public record ScheduleCatalogEntry(
    long ScheduleId,
    string ScheduleUniqueId,
    string Name,
    string? CategoryName,
    bool IsTemplate,
    string? ViewTemplateName,
    bool IsItemized,
    bool FilterBySheet,
    bool IsPlacedOnSheet,
    List<ScheduleCatalogSheetPlacement> SheetPlacements,
    List<ScheduleFilterSpec> Filters,
    List<ScheduleParameterUsageEntry> ParameterUsages,
    List<ScheduleCatalogCustomParameterValue> CustomParameters,
    int VisibleBodyRowCount,
    int VisibleFamilyCount,
    int VisibleInstanceCount,
    List<ScheduleVisibleFamilyEntry> VisibleFamilies
);

[ExportTsInterface]
public record ScheduleCatalogData(
    List<ScheduleCatalogEntry> Entries,
    List<RevitDataIssue> Issues
);

[ExportTsInterface]
public record ScheduleProfilesQuery(
    ScheduleProfilesQueryKind Kind = ScheduleProfilesQueryKind.ScheduleReferences,
    List<long>? ScheduleIds = null,
    List<string>? ScheduleUniqueIds = null,
    List<string>? ScheduleNames = null,
    bool IncludeTemplates = true
);

[ExportTsInterface]
public record ScheduleProfileQueryEntry(
    long ScheduleId,
    string ScheduleUniqueId,
    string Name,
    string? CategoryName,
    bool IsTemplate,
    ScheduleProfile Profile,
    List<ScheduleParameterUsageEntry> ParameterUsages,
    List<ScheduleCatalogCustomParameterValue> CustomParameters
);

[ExportTsInterface]
public record ScheduleProfilesQueryData(
    string DocumentTitle,
    ScheduleProfilesQueryKind QueryKind,
    int RequestedScheduleCount,
    int ResolvedScheduleCount,
    List<ScheduleProfileQueryEntry> Entries,
    List<RevitDataIssue> Issues
);

[ExportTsInterface]
public record ScheduleQuery(
    ScheduleQueryKind Kind = ScheduleQueryKind.ScheduleReferences,
    List<long>? ScheduleIds = null,
    List<string>? ScheduleUniqueIds = null,
    List<string>? ScheduleNames = null
);

[ExportTsInterface]
public record ScheduleRenderedColumn(
    int ColumnNumber,
    string HeaderText,
    string Key
);

[ExportTsInterface]
public record ScheduleVisibleInstanceEntry(
    long InstanceId,
    string InstanceUniqueId,
    string FamilyName,
    string FamilyTypeName,
    string? CategoryName
);

[ExportTsInterface]
public record ScheduleRenderedRow(
    int RowNumber,
    List<string> Values,
    List<long> InstanceIds
);

[ExportTsInterface]
public record ScheduleRenderedScheduleEntry(
    long ScheduleId,
    string ScheduleUniqueId,
    string ScheduleName,
    string? CategoryName,
    bool IsTemplate,
    bool IsPlacedOnSheet,
    List<ScheduleCatalogSheetPlacement> SheetPlacements,
    int VisibleBodyRowCount,
    int VisibleFamilyCount,
    int VisibleInstanceCount,
    List<ScheduleVisibleFamilyEntry> VisibleFamilies,
    List<ScheduleVisibleInstanceEntry> VisibleInstances,
    List<ScheduleRenderedColumn> Columns,
    List<ScheduleRenderedRow> Rows
);

[ExportTsInterface]
public record ScheduleQueryData(
    string DocumentTitle,
    ScheduleQueryKind QueryKind,
    int RequestedScheduleCount,
    int ResolvedScheduleCount,
    List<ScheduleRenderedScheduleEntry> Entries,
    List<RevitDataIssue> Issues
);
