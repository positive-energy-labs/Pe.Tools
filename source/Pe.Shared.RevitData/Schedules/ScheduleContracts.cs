using Pe.Shared.RevitData;
using Newtonsoft.Json;
using Newtonsoft.Json.Converters;

namespace Pe.Shared.RevitData.Schedules;

[JsonConverter(typeof(StringEnumConverter))]
public enum ScheduleProfilesQueryKind {
    CurrentActiveView,
    ScheduleReferences,
    ScheduleNames
}

[JsonConverter(typeof(StringEnumConverter))]
public enum ScheduleQueryKind {
    CurrentActiveView,
    ScheduleReferences,
    ScheduleNames
}

[JsonConverter(typeof(StringEnumConverter))]
public enum ScheduleCustomParameterMatchKind {
    Equals
}

public record ScheduleCustomParameterFilter(
    ParameterReference Parameter,
    string ExpectedValue,
    ScheduleCustomParameterMatchKind MatchKind
);

[JsonConverter(typeof(StringEnumConverter))]
public enum SchedulePlacementScope {
    All,
    PlacedOnly,
    UnplacedOnly
}

public record ScheduleCatalogProjection {
    public RevitDataResultView View { get; init; } = RevitDataResultView.Summary;
    public bool IncludeFilters { get; init; }
    public bool IncludeParameterUsages { get; init; }
    public bool IncludeCustomParameters { get; init; }
    public bool IncludeVisibleFamilies { get; init; }
    public bool IncludeSheetPlacements { get; init; } = true;
}

public record ScheduleCatalogRequest {
    public List<string> CategoryNames { get; init; } = [];
    public List<string> ScheduleNames { get; init; } = [];
    public string? ScheduleNameContains { get; init; }
    public string? ScheduleNamePrefix { get; init; }
    public SchedulePlacementScope PlacementScope { get; init; } = SchedulePlacementScope.All;
    public string? SheetNumberContains { get; init; }
    public string? SheetNameContains { get; init; }
    public bool? IsEmpty { get; init; }
    public List<ScheduleCustomParameterFilter> CustomParameterFilters { get; init; } = [];
    public ProjectBrowserFilter? BrowserFilter { get; init; }
    public bool IncludeTemplates { get; init; }
    public ScheduleCatalogProjection? Projection { get; init; }
    public RevitDataOutputBudget? Budget { get; init; }
}

public record ScheduleProfilesQueryRequest(
    ScheduleProfilesQuery? Query = null
);

public record ScheduleQueryRequest(
    ScheduleQuery? Query = null
);

public record ScheduleOnFinishSettings {
    public ScheduleOnFinishSettings() {
    }

    public ScheduleOnFinishSettings(bool openScheduleOnFinish) {
        this.OpenScheduleOnFinish = openScheduleOnFinish;
    }

    public bool OpenScheduleOnFinish { get; init; }
}

[JsonConverter(typeof(StringEnumConverter))]
public enum ScheduleTitleHorizontalAlignment {
    Left,
    Center,
    Right
}

[JsonConverter(typeof(StringEnumConverter))]
public enum ScheduleFieldHorizontalAlignment {
    Left,
    Center,
    Right
}

[JsonConverter(typeof(StringEnumConverter))]
public enum ScheduleColumnHeaderVerticalAlignment {
    Center,
    Top,
    Bottom
}

[JsonConverter(typeof(StringEnumConverter))]
public enum ScheduleAuthoredFieldDisplayType {
    Standard,
    Totals,
    MinMax,
    Max,
    Min
}

[JsonConverter(typeof(StringEnumConverter))]
public enum ScheduleAuthoredCalculatedFieldType {
    Formula,
    Percentage
}

[JsonConverter(typeof(StringEnumConverter))]
public enum ScheduleAuthoredSortOrder {
    Ascending,
    Descending
}

[JsonConverter(typeof(StringEnumConverter))]
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

public record ScheduleTitleBorderSpec {
    public string? TopLineStyleName { get; init; }
    public string? BottomLineStyleName { get; init; }
    public string? LeftLineStyleName { get; init; }
    public string? RightLineStyleName { get; init; }
}

public record ScheduleTitleStyleSpec {
    public ScheduleTitleHorizontalAlignment HorizontalAlignment { get; init; } = ScheduleTitleHorizontalAlignment.Left;
    public ScheduleTitleBorderSpec? BorderStyle { get; init; }
}

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

public record CombinedParameterSpec {
    public CombinedParameterSpec() {
    }

    public CombinedParameterSpec(string parameterName) {
        this.Parameter = ParameterReference.FromName(parameterName);
    }

    public ParameterReference Parameter { get; init; } = new();
    public string? ParameterName { get; init; }
    public string? Prefix { get; init; }
    public string? Suffix { get; init; }
    public string? Separator { get; init; } = " ";

    public ParameterReference GetEffectiveParameter() =>
        ScheduleParameterReferenceSelection.GetEffectiveParameter(this.Parameter, this.ParameterName);
}

public record ScheduleFieldSpec {
    public ScheduleFieldSpec() {
    }

    public ScheduleFieldSpec(string parameterName) {
        this.Parameter = ParameterReference.FromName(parameterName);
    }

    public ParameterReference Parameter { get; init; } = new();
    public string? ParameterName { get; init; }
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

    public ParameterReference GetEffectiveParameter() =>
        ScheduleParameterReferenceSelection.GetEffectiveParameter(this.Parameter, this.ParameterName);
}

internal static class ScheduleParameterReferenceSelection {
    public static ParameterReference GetEffectiveParameter(ParameterReference? parameter, string? parameterName) =>
        HasLookupSignal(parameter)
            ? parameter!
            : ParameterReference.FromName(parameterName?.Trim() ?? string.Empty);

    private static bool HasLookupSignal(ParameterReference? parameter) =>
        parameter?.Identity != null ||
        !string.IsNullOrWhiteSpace(parameter?.SharedGuid) ||
        !string.IsNullOrWhiteSpace(parameter?.Name);
}

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
public record ScheduleCatalogSheetPlacement(
    string SheetNumber,
    string SheetName,
    bool IsIssuedLikeSheet,
    bool IsWorkingLikeSheet,
    string SheetRole
);

public record ScheduleCatalogCustomParameterValue(
    ParameterDefinitionDescriptor Definition,
    string? Value,
    string? DisplayValue,
    RequestedParameterStorageType StorageType
) {
    public string Name => this.Definition.Identity.Name;
}

public record ScheduleVisibleFamilyEntry(
    long FamilyId,
    string FamilyName,
    string? CategoryName,
    int VisibleInstanceCount
);

public record ScheduleFieldParameterDescriptor(
    ParameterDefinitionDescriptor? Definition,
    string? FieldType
) {
    public ParameterIdentity? Identity => this.Definition?.Identity;
    public string? SpecTypeId => this.Definition?.DataTypeId;
}

public record ScheduleParameterUsageEntry(
    string FieldName,
    string ColumnHeading,
    string Key
) {
    public ScheduleFieldParameterDescriptor? Parameter { get; init; }
    public int FieldIndex { get; init; }
    public bool IsHidden { get; init; }
    public bool IsCalculated { get; init; }
    public bool IsCombinedParameter { get; init; }
}

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
    List<ScheduleVisibleFamilyEntry> VisibleFamilies,
    List<ProjectBrowserPath> BrowserPaths
);

public record ScheduleCatalogNameGroup(
    string NormalizedName,
    int Count,
    List<string> Names
);

public record ScheduleCatalogNameTokenCount(
    string Token,
    int Count
);

public record ScheduleCatalogFieldUsageSummary(
    string FieldName,
    int ScheduleCount,
    double AverageFieldIndex
);

public record ScheduleCatalogFieldFingerprint(
    long ScheduleId,
    string ScheduleName,
    string NormalizedScheduleName,
    List<string> FieldSequence,
    string FieldSetHash,
    string OrderedFieldHash,
    Dictionary<string, int> PrefixDistribution
);

public record ScheduleCatalogSummary(
    int TotalSchedules,
    List<ScheduleCatalogNameGroup> DuplicateNormalizedNameGroups,
    List<ScheduleCatalogNameTokenCount> PrefixCounts,
    List<ScheduleCatalogNameTokenCount> SuffixCounts,
    List<ScheduleCatalogFieldUsageSummary> TopScheduledFields,
    List<ScheduleCatalogFieldFingerprint> FieldFingerprints
);

public record ScheduleCatalogData(
    List<ScheduleCatalogEntry> Entries,
    List<RevitDataIssue> Issues,
    RevitDataResultPage? Page = null,
    ScheduleCatalogSummary? Summary = null
);

public record ScheduleProfilesQuery(
    ScheduleProfilesQueryKind Kind = ScheduleProfilesQueryKind.ScheduleReferences,
    List<long>? ScheduleIds = null,
    List<string>? ScheduleUniqueIds = null,
    List<string>? ScheduleNames = null,
    bool IncludeTemplates = true
);

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

public record ScheduleProfilesQueryData(
    string DocumentTitle,
    ScheduleProfilesQueryKind QueryKind,
    int RequestedScheduleCount,
    int ResolvedScheduleCount,
    List<ScheduleProfileQueryEntry> Entries,
    List<RevitDataIssue> Issues
);

public record ScheduleRequiredFieldAudit {
    public List<string> FieldNames { get; init; } = [];
    public bool TreatZeroAsDefault { get; init; }
    public bool TreatDashAsBlank { get; init; } = true;
}

public record ScheduleQueryProjection {
    public RevitDataResultView View { get; init; } = RevitDataResultView.Summary;
    public bool IncludeColumns { get; init; }
    public bool IncludeSubjects { get; init; }
    public bool IncludeCellValues { get; init; }
    public bool IncludeRows { get; init; }
    public bool IncludeOnlyRowsWithIssues { get; init; }
    public ScheduleRequiredFieldAudit? RequiredFieldAudit { get; init; }
}

public record ScheduleQuery(
    ScheduleQueryKind Kind = ScheduleQueryKind.ScheduleReferences,
    List<long>? ScheduleIds = null,
    List<string>? ScheduleUniqueIds = null,
    List<string>? ScheduleNames = null,
    ScheduleQueryProjection? Projection = null,
    RevitDataOutputBudget? Budget = null
);

public record ScheduleRenderedColumn(
    int ColumnNumber,
    string HeaderText,
    string Key,
    string FieldName,
    int ProfileFieldIndex
) {
    public ScheduleFieldParameterDescriptor? Parameter { get; init; }
    public bool IsCalculated { get; init; }
    public bool IsCombinedParameter { get; init; }
}

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
public enum ScheduleRenderedRowKind {
    Data,
    GroupFooter
}

[JsonConverter(typeof(StringEnumConverter))]
public enum ScheduleRenderedRowBindingKind {
    None,
    SingleSubject,
    MultipleSubjects
}

[JsonConverter(typeof(StringEnumConverter))]
public enum ScheduleRenderedRowSubjectResolutionStatus {
    NotApplicable,
    NonBindable,
    Unbound,
    Bound
}

[JsonConverter(typeof(StringEnumConverter))]
public enum ScheduleRenderedRowSubjectResolutionReason {
    None,
    NonDataRow,
    NoVisibleSubjects,
    NoComparableValues,
    HeuristicMismatch
}

[JsonConverter(typeof(StringEnumConverter))]
public enum ScheduleRenderedBindingStatus {
    None,
    Partial,
    Complete
}

public record ScheduleRenderedCellIssue(
    int RowNumber,
    int ColumnNumber,
    string FieldName,
    string HeaderText,
    string Code,
    string Message
);

public record ScheduleRenderedRow(
    int RowNumber,
    ScheduleRenderedRowKind Kind,
    List<string> Values,
    ScheduleRenderedRowBindingKind BindingKind,
    ScheduleRenderedRowSubjectResolutionStatus ResolutionStatus,
    ScheduleRenderedRowSubjectResolutionReason ResolutionReason,
    List<long> SubjectIds,
    List<ScheduleRenderedCellIssue>? Issues = null
);

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
    List<ScheduleRenderedRow> Rows,
    List<ScheduleRenderedCellIssue>? RowIssues = null
);

public record ScheduleQueryData(
    string DocumentTitle,
    ScheduleQueryKind QueryKind,
    int RequestedScheduleCount,
    int ResolvedScheduleCount,
    List<ScheduleRenderedScheduleEntry> Entries,
    List<RevitDataIssue> Issues,
    RevitDataResultPage? Page = null
);
