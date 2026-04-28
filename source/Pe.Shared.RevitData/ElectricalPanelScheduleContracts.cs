using Newtonsoft.Json;
using Newtonsoft.Json.Converters;
using TypeGen.Core.TypeAnnotations;

namespace Pe.Shared.RevitData;

[JsonConverter(typeof(StringEnumConverter))]
[ExportTsEnum]
public enum ElectricalPanelSchedulesQueryKind {
    CurrentActiveView,
    ScheduleReferences,
    PanelReferences
}

[JsonConverter(typeof(StringEnumConverter))]
[ExportTsEnum]
public enum ElectricalPanelScheduleSectionType {
    Header,
    Body,
    Summary,
    Footer
}

[JsonConverter(typeof(StringEnumConverter))]
[ExportTsEnum]
public enum ElectricalPanelScheduleCellSourceKind {
    Unknown,
    TextOnly,
    Parameter,
    Combined,
    Calculated
}

[ExportTsInterface]
public record ElectricalPanelSchedulesQueryRequest(
    ElectricalPanelSchedulesQuery? Query = null
);

[ExportTsInterface]
public record ElectricalPanelSchedulesQuery(
    ElectricalPanelSchedulesQueryKind Kind = ElectricalPanelSchedulesQueryKind.ScheduleReferences,
    List<long>? ScheduleIds = null,
    List<string>? ScheduleUniqueIds = null,
    List<long>? PanelIds = null,
    List<string>? PanelUniqueIds = null,
    List<string>? PanelNames = null
);

[ExportTsInterface]
public record ElectricalPanelScheduleMergedRegion(
    int TopRowNumber,
    int LeftColumnNumber,
    int BottomRowNumber,
    int RightColumnNumber
);

[ExportTsInterface]
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

[ExportTsInterface]
public record ElectricalPanelScheduleRowProjection(
    int RowNumber,
    bool IsCircuitTableRow,
    List<ElectricalPanelScheduleCellProjection> Cells
);

[ExportTsInterface]
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

[ExportTsInterface]
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

[ExportTsInterface]
public record ElectricalPanelSchedulesQueryData(
    string DocumentTitle,
    ElectricalPanelSchedulesQueryKind QueryKind,
    int RequestedScheduleCount,
    int ResolvedScheduleCount,
    List<ElectricalPanelScheduleProjection> Entries,
    List<RevitDataIssue> Issues
);
