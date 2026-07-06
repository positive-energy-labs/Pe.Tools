using Newtonsoft.Json;
using Newtonsoft.Json.Converters;

namespace Pe.Shared.RevitData;

[JsonConverter(typeof(StringEnumConverter))]
public enum ElectricalPanelSchedulesQueryKind {
    CurrentActiveView,
    ScheduleReferences,
    PanelReferences
}

[JsonConverter(typeof(StringEnumConverter))]
public enum ElectricalPanelScheduleSectionType {
    Header,
    Body,
    Summary,
    Footer
}

[JsonConverter(typeof(StringEnumConverter))]
public enum ElectricalPanelScheduleCellSourceKind {
    Unknown,
    TextOnly,
    Parameter,
    Combined,
    Calculated
}

[JsonConverter(typeof(StringEnumConverter))]
public enum ElectricalPanelScheduleProjectionView {
    FullSections,
    RowsOnly
}

public record ElectricalPanelScheduleProjectionOptions {
    public ElectricalPanelScheduleProjectionView View { get; init; } = ElectricalPanelScheduleProjectionView.FullSections;
    public List<string> CircuitNumbers { get; init; } = [];
    public List<string> LoadNameContains { get; init; } = [];
    public int? MaxRows { get; init; }
}

public record ElectricalPanelSchedulesQueryRequest(
    ElectricalPanelSchedulesQuery? Query = null
);

public record ElectricalPanelSchedulesQuery(
    ElectricalPanelSchedulesQueryKind Kind = ElectricalPanelSchedulesQueryKind.ScheduleReferences,
    List<long>? ScheduleIds = null,
    List<string>? ScheduleUniqueIds = null,
    List<long>? PanelIds = null,
    List<string>? PanelUniqueIds = null,
    List<string>? PanelNames = null,
    ElectricalPanelScheduleProjectionOptions? Projection = null
);

public record ElectricalPanelScheduleMergedRegion(
    int TopRowNumber,
    int LeftColumnNumber,
    int BottomRowNumber,
    int RightColumnNumber
);

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

public record ElectricalPanelScheduleRowProjection(
    int RowNumber,
    bool IsCircuitTableRow,
    List<ElectricalPanelScheduleCellProjection> Cells
);

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

public record ElectricalPanelSchedulesQueryData(
    string DocumentTitle,
    ElectricalPanelSchedulesQueryKind QueryKind,
    int RequestedScheduleCount,
    int ResolvedScheduleCount,
    List<ElectricalPanelScheduleProjection> Entries,
    List<RevitDataIssue> Issues
);
