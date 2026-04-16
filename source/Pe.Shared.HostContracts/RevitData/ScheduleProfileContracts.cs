using Newtonsoft.Json;
using Newtonsoft.Json.Converters;
using Pe.Shared.HostContracts.Operations;
using Pe.Shared.HostContracts.Protocol;
using Pe.Shared.HostContracts.SettingsStorage;
using TypeGen.Core.TypeAnnotations;

namespace Pe.Shared.HostContracts.RevitData;

[ExportTsInterface]
public record ScheduleCatalogRequest : IBridgeSessionRequest {
    public List<string> CategoryNames { get; init; } = [];
    public List<string> ScheduleNames { get; init; } = [];
    public bool IncludeTemplates { get; init; }
    public BridgeSessionSelector? Target { get; init; }
}

[JsonConverter(typeof(StringEnumConverter))]
[ExportTsEnum]
public enum ScheduleParameterUsageKind {
    Field,
    CombinedComponent
}

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
public enum ScheduleSectionType {
    Header,
    Body,
    Summary,
    Footer
}

[JsonConverter(typeof(StringEnumConverter))]
[ExportTsEnum]
public enum ScheduleCellSourceKind {
    Unknown,
    TextOnly,
    Parameter,
    Combined,
    Calculated
}

[ExportTsInterface]
public record ScheduleParameterUsageEntry(
    string FieldName,
    string ColumnHeading,
    bool IsHidden,
    ScheduleParameterUsageKind UsageKind,
    ParameterIdentity Identity
);

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
    List<string> FieldParameterNames,
    List<ScheduleFilterSpec> Filters,
    List<ScheduleParameterUsageEntry> ParameterUsages,
    List<ScheduleCatalogCustomParameterValue> CustomParameters
);

[ExportTsInterface]
public record ScheduleCatalogData(
    List<ScheduleCatalogEntry> Entries,
    List<RevitDataIssue> Issues
);

[ExportTsInterface]
public record ScheduleCatalogEnvelopeResponse(
    bool Ok,
    EnvelopeCode Code,
    string Message,
    List<ValidationIssue> Issues,
    ScheduleCatalogData? Data
) : IHostDataEnvelope<ScheduleCatalogData> {
    public object? GetData() => this.Data;
}

[ExportTsInterface]
public record ScheduleProfilesQuery(
    ScheduleProfilesQueryKind Kind = ScheduleProfilesQueryKind.ScheduleReferences,
    List<long>? ScheduleIds = null,
    List<string>? ScheduleUniqueIds = null,
    List<string>? ScheduleNames = null,
    bool IncludeTemplates = true
);

[ExportTsInterface]
public record ScheduleProfilesQueryRequest(
    ScheduleProfilesQuery? Query = null,
    BridgeSessionSelector? Target = null
) : IBridgeSessionRequest;

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
public record ScheduleProfilesQueryEnvelopeResponse(
    bool Ok,
    EnvelopeCode Code,
    string Message,
    List<ValidationIssue> Issues,
    ScheduleProfilesQueryData? Data
) : IHostDataEnvelope<ScheduleProfilesQueryData> {
    public object? GetData() => this.Data;
}

[ExportTsInterface]
public record ScheduleQuery(
    ScheduleQueryKind Kind = ScheduleQueryKind.ScheduleReferences,
    List<long>? ScheduleIds = null,
    List<string>? ScheduleUniqueIds = null,
    List<string>? ScheduleNames = null
);

[ExportTsInterface]
public record ScheduleQueryRequest(
    ScheduleQuery? Query = null,
    BridgeSessionSelector? Target = null
) : IBridgeSessionRequest;

[ExportTsInterface]
public record ScheduleMergedRegion(
    int TopRowNumber,
    int LeftColumnNumber,
    int BottomRowNumber,
    int RightColumnNumber
);

[ExportTsInterface]
public record ScheduleCellProjection(
    int ColumnNumber,
    string DisplayText,
    string? ColumnHeaderText,
    bool IsBlank,
    ScheduleCellSourceKind SourceKind,
    string? ParameterText,
    string? CombinedText,
    string? CalculatedValueName,
    string? CalculatedValueText,
    ScheduleMergedRegion? MergedRegion
);

[ExportTsInterface]
public record ScheduleRowProjection(
    int RowNumber,
    List<ScheduleCellProjection> Cells
);

[ExportTsInterface]
public record ScheduleSectionProjection(
    ScheduleSectionType SectionType,
    bool IsValid,
    int FirstRowNumber,
    int LastRowNumber,
    int FirstColumnNumber,
    int LastColumnNumber,
    int NumberOfRows,
    int NumberOfColumns,
    List<ScheduleRowProjection> Rows
);

[ExportTsInterface]
public record ScheduleProjection(
    long ScheduleId,
    string ScheduleUniqueId,
    string ScheduleName,
    string? CategoryName,
    bool IsTemplate,
    long? ViewTemplateId,
    string? ViewTemplateUniqueId,
    string? ViewTemplateName,
    bool IsPlacedOnSheet,
    List<ScheduleCatalogSheetPlacement> SheetPlacements,
    List<ScheduleSectionProjection> Sections
);

[ExportTsInterface]
public record ScheduleQueryData(
    string DocumentTitle,
    ScheduleQueryKind QueryKind,
    int RequestedScheduleCount,
    int ResolvedScheduleCount,
    List<ScheduleProjection> Entries,
    List<RevitDataIssue> Issues
);

[ExportTsInterface]
public record ScheduleQueryEnvelopeResponse(
    bool Ok,
    EnvelopeCode Code,
    string Message,
    List<ValidationIssue> Issues,
    ScheduleQueryData? Data
) : IHostDataEnvelope<ScheduleQueryData> {
    public object? GetData() => this.Data;
}
