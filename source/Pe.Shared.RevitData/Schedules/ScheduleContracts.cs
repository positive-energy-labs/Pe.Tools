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
public record ScheduleProfilesQueryRequest(
    ScheduleProfilesQuery? Query = null
);

[ExportTsInterface]
public record ScheduleQueryRequest(
    ScheduleQuery? Query = null
);

[ExportTsInterface]
public record ScheduleOnFinishSettings(
    bool OpenScheduleOnFinish
);

[JsonConverter(typeof(StringEnumConverter))]
[ExportTsEnum]
public enum ScheduleTitleHorizontalAlignment {
    Left,
    Center,
    Right
}

[JsonConverter(typeof(StringEnumConverter))]
[ExportTsEnum]
public enum ScheduleFieldHorizontalAlignment {
    Left,
    Center,
    Right
}

[JsonConverter(typeof(StringEnumConverter))]
[ExportTsEnum]
public enum ScheduleColumnHeaderVerticalAlignment {
    Center,
    Top,
    Bottom
}

[JsonConverter(typeof(StringEnumConverter))]
[ExportTsEnum]
public enum ScheduleAuthoredFieldDisplayType {
    Standard,
    Totals,
    MinMax,
    Max,
    Min
}

[JsonConverter(typeof(StringEnumConverter))]
[ExportTsEnum]
public enum ScheduleAuthoredCalculatedFieldType {
    Formula,
    Percentage
}

[JsonConverter(typeof(StringEnumConverter))]
[ExportTsEnum]
public enum ScheduleAuthoredSortOrder {
    Ascending,
    Descending
}

[JsonConverter(typeof(StringEnumConverter))]
[ExportTsEnum]
public enum ScheduleAuthoredFilterType {
    HasParameter,
    Equal,
    NotEqual,
    GreaterThan,
    GreaterThanOrEqual,
    LessThan,
    LessThanOrEqual,
    Contains,
    NotContains,
    BeginsWith,
    NotBeginsWith,
    EndsWith,
    NotEndsWith,
    IsAssociatedWithGlobalParameter,
    IsNotAssociatedWithGlobalParameter,
    HasValue,
    HasNoValue
}

[ExportTsInterface]
public record ScheduleTitleBorderSpec(
    string? TopLineStyleName = null,
    string? BottomLineStyleName = null,
    string? LeftLineStyleName = null,
    string? RightLineStyleName = null
);

[ExportTsInterface]
public record ScheduleTitleStyleSpec(
    ScheduleTitleHorizontalAlignment HorizontalAlignment = ScheduleTitleHorizontalAlignment.Left,
    ScheduleTitleBorderSpec? BorderStyle = null
);

[ExportTsInterface]
public record ScheduleFieldFormatSpec(
    string? UnitTypeId,
    string? SymbolTypeId,
    double? Accuracy,
    bool SuppressTrailingZeros = false,
    bool SuppressLeadingZeros = false,
    bool UsePlusPrefix = false,
    bool UseDigitGrouping = false,
    bool SuppressSpaces = false
);

[ExportTsInterface]
public record CombinedParameterSpec(
    string ParameterName,
    string? Prefix = null,
    string? Suffix = null,
    string? Separator = null
);

[ExportTsInterface]
public record ScheduleFieldSpec(
    string ParameterName,
    string? ColumnHeaderOverride = null,
    string? HeaderGroup = null,
    bool IsHidden = false,
    ScheduleAuthoredFieldDisplayType DisplayType = ScheduleAuthoredFieldDisplayType.Standard,
    double? ColumnWidth = null,
    ScheduleFieldHorizontalAlignment HorizontalAlignment = ScheduleFieldHorizontalAlignment.Center,
    ScheduleAuthoredCalculatedFieldType? CalculatedType = null,
    string? PercentageOfField = null,
    ScheduleFieldFormatSpec? FormatOptions = null,
    List<CombinedParameterSpec>? CombinedParameters = null
);

[ExportTsInterface]
public record ScheduleSortGroupSpec(
    string FieldName,
    ScheduleAuthoredSortOrder SortOrder = ScheduleAuthoredSortOrder.Ascending,
    bool ShowHeader = false,
    bool ShowFooter = false,
    bool ShowBlankLine = false
);

[ExportTsInterface]
public record ScheduleFilterSpec(
    string FieldName,
    ScheduleAuthoredFilterType FilterType = ScheduleAuthoredFilterType.Equal,
    string? Value = null
);

[ExportTsInterface]
public record ScheduleProfile(
    string Name,
    string CategoryName,
    string? ViewTemplateName = null,
    ScheduleTitleStyleSpec? TitleStyle = null,
    bool IsItemized = true,
    bool FilterBySheet = false,
    ScheduleColumnHeaderVerticalAlignment ColumnHeaderVerticalAlignment = ScheduleColumnHeaderVerticalAlignment.Bottom,
    List<ScheduleFieldSpec>? Fields = null,
    List<ScheduleSortGroupSpec>? SortGroup = null,
    List<ScheduleFilterSpec>? Filters = null,
    ScheduleOnFinishSettings? OnFinishSettings = null
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
    string Key,
    string FieldName,
    int ProfileFieldIndex
);

[ExportTsInterface]
public record ScheduleRenderedSubject(
    long SubjectId,
    string SubjectUniqueId,
    string Kind,
    string? CategoryName,
    string DisplayName,
    long? FamilyId,
    string? FamilyName,
    string? FamilyTypeName
);

[JsonConverter(typeof(StringEnumConverter))]
[ExportTsEnum]
public enum ScheduleRenderedRowKind {
    Data,
    GroupFooter
}

[JsonConverter(typeof(StringEnumConverter))]
[ExportTsEnum]
public enum ScheduleRenderedRowBindingKind {
    None,
    SingleSubject,
    MultipleSubjects
}

[JsonConverter(typeof(StringEnumConverter))]
[ExportTsEnum]
public enum ScheduleRenderedRowSubjectResolutionStatus {
    NotApplicable,
    NonBindable,
    Unbound,
    Bound
}

[JsonConverter(typeof(StringEnumConverter))]
[ExportTsEnum]
public enum ScheduleRenderedRowSubjectResolutionReason {
    None,
    NonDataRow,
    NoVisibleSubjects,
    NoComparableValues,
    HeuristicMismatch
}

[JsonConverter(typeof(StringEnumConverter))]
[ExportTsEnum]
public enum ScheduleRenderedBindingStatus {
    None,
    Partial,
    Complete
}

[ExportTsInterface]
public record ScheduleRenderedRow(
    int RowNumber,
    ScheduleRenderedRowKind Kind,
    List<string> Values,
    ScheduleRenderedRowBindingKind BindingKind,
    ScheduleRenderedRowSubjectResolutionStatus ResolutionStatus,
    ScheduleRenderedRowSubjectResolutionReason ResolutionReason,
    List<long> SubjectIds
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
    bool IsEmpty,
    ScheduleRenderedBindingStatus BindingStatus,
    int NotApplicableRowCount,
    int NonBindableRowCount,
    int BindableRowCount,
    int BoundRowCount,
    int UnboundRowCount,
    int VisibleBodyRowCount,
    int SubjectCount,
    List<ScheduleRenderedSubject> Subjects,
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
