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
public record ScheduleTitleBorderStyleDefinition(
    string? TopLineStyleName,
    string? BottomLineStyleName,
    string? LeftLineStyleName,
    string? RightLineStyleName
);

[ExportTsInterface]
public record ScheduleTitleStyleDefinition(
    string HorizontalAlignment,
    ScheduleTitleBorderStyleDefinition BorderStyle
);

[ExportTsInterface]
public record ScheduleFieldFormatDefinition(
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
public record CombinedParameterDefinition(
    string ParameterName,
    string Prefix,
    string Suffix,
    string Separator
);

[ExportTsInterface]
public record ScheduleFieldDefinition(
    string ParameterName,
    string ColumnHeaderOverride,
    string HeaderGroup,
    bool IsHidden,
    string DisplayType,
    double? ColumnWidth,
    string HorizontalAlignment,
    string? CalculatedType,
    string PercentageOfField,
    ScheduleFieldFormatDefinition? FormatOptions,
    List<CombinedParameterDefinition>? CombinedParameters
);

[ExportTsInterface]
public record ScheduleSortGroupDefinition(
    string FieldName,
    string SortOrder,
    bool ShowHeader,
    bool ShowFooter,
    bool ShowBlankLine
);

[ExportTsInterface]
public record ScheduleFilterDefinition(
    string FieldName,
    string FilterType,
    string Value
);

[ExportTsInterface]
public record ScheduleDefinition(
    string Name,
    string CategoryName,
    string? ViewTemplateName,
    ScheduleTitleStyleDefinition TitleStyle,
    bool IsItemized,
    bool FilterBySheet,
    List<ScheduleFieldDefinition> Fields,
    List<ScheduleSortGroupDefinition> SortGroup,
    List<ScheduleFilterDefinition> Filters,
    ScheduleOnFinishSettings? OnFinishSettings
);

[ExportTsInterface]
public record ScheduleCatalogEntry(
    long ScheduleId,
    string ScheduleUniqueId,
    string Name,
    string? CategoryName,
    bool IsTemplate,
    ScheduleDefinition Definition,
    List<ScheduleParameterUsageEntry> ParameterUsages
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
