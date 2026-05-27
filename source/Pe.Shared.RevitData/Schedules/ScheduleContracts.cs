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
public record ScheduleOnFinishSettings {
    public ScheduleOnFinishSettings() {
    }

    public ScheduleOnFinishSettings(bool openScheduleOnFinish) {
        this.OpenScheduleOnFinish = openScheduleOnFinish;
    }

    public bool OpenScheduleOnFinish { get; init; }
}

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
public record ScheduleTitleBorderSpec {
    public string? TopLineStyleName { get; init; }
    public string? BottomLineStyleName { get; init; }
    public string? LeftLineStyleName { get; init; }
    public string? RightLineStyleName { get; init; }
}

[ExportTsInterface]
public record ScheduleTitleStyleSpec {
    public ScheduleTitleHorizontalAlignment HorizontalAlignment { get; init; } = ScheduleTitleHorizontalAlignment.Left;
    public ScheduleTitleBorderSpec? BorderStyle { get; init; }
}

[ExportTsInterface]
public record ScheduleFieldFormatSpec {
    public string? UnitTypeId { get; init; }
    public string? SymbolTypeId { get; init; }
    public double? Accuracy { get; init; }
    public bool SuppressTrailingZeros { get; init; }
    public bool SuppressLeadingZeros { get; init; }
    public bool UsePlusPrefix { get; init; }
    public bool UseDigitGrouping { get; init; }
    public bool SuppressSpaces { get; init; }
}

[ExportTsInterface]
public record CombinedParameterSpec {
    public CombinedParameterSpec() {
    }

    public CombinedParameterSpec(string parameterName) {
        this.ParameterName = parameterName;
    }

    public string ParameterName { get; init; } = string.Empty;
    public string? Prefix { get; init; }
    public string? Suffix { get; init; }
    public string? Separator { get; init; } = " ";
}

[ExportTsInterface]
public record ScheduleFieldSpec {
    public ScheduleFieldSpec() {
    }

    public ScheduleFieldSpec(string parameterName) {
        this.ParameterName = parameterName;
    }

    public string ParameterName { get; init; } = string.Empty;
    public string? ColumnHeaderOverride { get; init; }
    public string? HeaderGroup { get; init; }
    public bool IsHidden { get; init; }
    public ScheduleAuthoredFieldDisplayType DisplayType { get; init; } = ScheduleAuthoredFieldDisplayType.Standard;
    public double? ColumnWidth { get; init; }
    public ScheduleFieldHorizontalAlignment HorizontalAlignment { get; init; } = ScheduleFieldHorizontalAlignment.Center;
    public ScheduleAuthoredCalculatedFieldType? CalculatedType { get; init; }
    public string? PercentageOfField { get; init; }
    public ScheduleFieldFormatSpec? FormatOptions { get; init; }
    public List<CombinedParameterSpec> CombinedParameters { get; init; } = [];
}

[ExportTsInterface]
public record ScheduleSortGroupSpec {
    public ScheduleSortGroupSpec() {
    }

    public ScheduleSortGroupSpec(string fieldName) {
        this.FieldName = fieldName;
    }

    public string FieldName { get; init; } = string.Empty;
    public ScheduleAuthoredSortOrder SortOrder { get; init; } = ScheduleAuthoredSortOrder.Ascending;
    public bool ShowHeader { get; init; }
    public bool ShowFooter { get; init; }
    public bool ShowBlankLine { get; init; }
}

[ExportTsInterface]
public record ScheduleFilterSpec {
    public ScheduleFilterSpec() {
    }

    public ScheduleFilterSpec(string fieldName) {
        this.FieldName = fieldName;
    }

    public string FieldName { get; init; } = string.Empty;
    public ScheduleAuthoredFilterType FilterType { get; init; } = ScheduleAuthoredFilterType.Equal;
    public string? Value { get; init; }
}

[ExportTsInterface]
public record ScheduleProfile {
    private const string DefaultTitleBottomLineStyleName = "Thin Lines";

    public ScheduleProfile() {
    }

    public ScheduleProfile(string name, string categoryName) {
        this.Name = name;
        this.CategoryName = categoryName;
    }

    public string Name { get; init; } = string.Empty;
    public string CategoryName { get; init; } = string.Empty;
    public string? ViewTemplateName { get; init; }
    public ScheduleTitleStyleSpec TitleStyle { get; init; } = CreateDefaultTitleStyle();
    public bool IsItemized { get; init; } = true;
    public bool FilterBySheet { get; init; }
    public ScheduleColumnHeaderVerticalAlignment ColumnHeaderVerticalAlignment { get; init; } = ScheduleColumnHeaderVerticalAlignment.Bottom;
    public List<ScheduleFieldSpec> Fields { get; init; } = [];
    public List<ScheduleSortGroupSpec> SortGroup { get; init; } = [];
    public List<ScheduleFilterSpec> Filters { get; init; } = [];
    public ScheduleOnFinishSettings? OnFinishSettings { get; init; }

    private static ScheduleTitleStyleSpec CreateDefaultTitleStyle() =>
        new() {
            BorderStyle = new ScheduleTitleBorderSpec { BottomLineStyleName = DefaultTitleBottomLineStyleName }
        };
}
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
