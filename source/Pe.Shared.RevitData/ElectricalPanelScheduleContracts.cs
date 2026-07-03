using Newtonsoft.Json;
using Newtonsoft.Json.Converters;
using Pe.Shared.Codegen;

namespace Pe.Shared.RevitData;

[JsonConverter(typeof(StringEnumConverter))]
[ExportTsSchema]
public enum ElectricalPanelSchedulesQueryKind {
    CurrentActiveView,
    ScheduleReferences,
    PanelReferences
}

[JsonConverter(typeof(StringEnumConverter))]
[ExportTsSchema]
public enum ElectricalPanelScheduleSectionType {
    Header,
    Body,
    Summary,
    Footer
}

[JsonConverter(typeof(StringEnumConverter))]
[ExportTsSchema]
public enum ElectricalPanelScheduleCellSourceKind {
    Unknown,
    TextOnly,
    Parameter,
    Combined,
    Calculated
}

[JsonConverter(typeof(StringEnumConverter))]
[ExportTsSchema]
public enum ElectricalPanelScheduleProjectionView {
    FullSections,
    RowsOnly
}

[ExportTsSchema]
public record ElectricalPanelScheduleProjectionOptions {
    public ElectricalPanelScheduleProjectionView View { get; init; } = ElectricalPanelScheduleProjectionView.FullSections;
    public List<string> CircuitNumbers { get; init; } = [];
    public List<string> LoadNameContains { get; init; } = [];
    public int? MaxRows { get; init; }
}

[ExportTsSchema]
public record ElectricalPanelSchedulesQueryRequest(
    ElectricalPanelSchedulesQuery? Query = null
);

[ExportTsSchema]
public record ElectricalPanelSchedulesQuery(
    ElectricalPanelSchedulesQueryKind Kind = ElectricalPanelSchedulesQueryKind.ScheduleReferences,
    List<long>? ScheduleIds = null,
    List<string>? ScheduleUniqueIds = null,
    List<long>? PanelIds = null,
    List<string>? PanelUniqueIds = null,
    List<string>? PanelNames = null,
    ElectricalPanelScheduleProjectionOptions? Projection = null
);

[ExportTsSchema]
public record ElectricalPanelScheduleMergedRegion(
    int TopRowNumber,
    int LeftColumnNumber,
    int BottomRowNumber,
    int RightColumnNumber
);

[ExportTsSchema]
public record ElectricalPanelScheduleCellProjection(
    int ColumnNumber,
    string DisplayText,
    string? ColumnHeaderText,
    bool IsBlank,
    long? CircuitId,
    string? CircuitUniqueId,
    ElectricalPanelScheduleCellSourceKind SourceKind,
    string? ParameterText,
    string? CombinedText,
    string? CalculatedValueName,
    string? CalculatedValueText,
    ElectricalPanelScheduleMergedRegion? MergedRegion
);

[ExportTsSchema]
public record ElectricalPanelScheduleRowProjection(
    int RowNumber,
    bool IsCircuitTableRow,
    List<ElectricalPanelScheduleCellProjection> Cells
);

[ExportTsSchema]
public record ElectricalPanelScheduleSectionProjection(
    ElectricalPanelScheduleSectionType SectionType,
    bool IsValid,
    int FirstRowNumber,
    int LastRowNumber,
    int FirstColumnNumber,
    int LastColumnNumber,
    int NumberOfRows,
    int NumberOfColumns,
    List<ElectricalPanelScheduleRowProjection> Rows
);

[ExportTsSchema]
public record ElectricalPanelScheduleProjection(
    long ScheduleId,
    string ScheduleUniqueId,
    string ScheduleName,
    long? PanelId,
    string? PanelUniqueId,
    string? PanelName,
    long? TemplateId,
    string? TemplateUniqueId,
    string? TemplateName,
    string? PanelScheduleType,
    List<ElectricalPanelScheduleSectionProjection> Sections
);

[ExportTsSchema]
public record ElectricalPanelSchedulesQueryData(
    string DocumentTitle,
    ElectricalPanelSchedulesQueryKind QueryKind,
    int RequestedScheduleCount,
    int ResolvedScheduleCount,
    List<ElectricalPanelScheduleProjection> Entries,
    List<RevitDataIssue> Issues
);
