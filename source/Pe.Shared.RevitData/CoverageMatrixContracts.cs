using Newtonsoft.Json;
using Newtonsoft.Json.Converters;
using Pe.Shared.RevitData.Schedules;
using Pe.Shared.Codegen;

namespace Pe.Shared.RevitData;

[JsonConverter(typeof(StringEnumConverter))]
[ExportTsSchema]
public enum RevitElementScope {
    All,
    ActiveViewVisible,
    ViewReferences,
    CurrentSelection,
    ExplicitHandles
}

[JsonConverter(typeof(StringEnumConverter))]
[ExportTsSchema]
public enum RevitParameterLookupPreference {
    InstanceThenType,
    InstanceOnly,
    TypeOnly
}

[ExportTsSchema]
public record RevitElementHandle(
    long ElementId,
    string UniqueId,
    string DisplayName,
    string? CategoryName,
    string? FamilyName,
    string? TypeName
);

[JsonConverter(typeof(StringEnumConverter))]
[ExportTsSchema]
public enum ScheduleRoleScope {
    All,
    IssuedOnly,
    WorkingOnly,
    ArchiveOnly,
    IssuedOrWorking
}

[ExportTsSchema]
public record ScheduleCoverageRequest {
    public List<string> CategoryNames { get; init; } = [];
    public RevitElementScope Scope { get; init; } = RevitElementScope.All;
    public List<long> ElementIds { get; init; } = [];
    public List<string> ElementUniqueIds { get; init; } = [];
    public List<long> ViewIds { get; init; } = [];
    public List<string> ViewUniqueIds { get; init; } = [];
    public ScheduleCatalogRequest? ScheduleFilter { get; init; }
    public ScheduleRoleScope ScheduleRoleScope { get; init; } = ScheduleRoleScope.All;
    public RevitDataOutputBudget? Budget { get; init; }
    public bool IncludeElementSamples { get; init; }
    public bool IncludeMissingElementHandles { get; init; }
    public bool IncludeMatchedScheduleNames { get; init; }
}

[ExportTsSchema]
public record ScheduleCoverageScheduleHit(
    long ScheduleId,
    string ScheduleUniqueId,
    string ScheduleName,
    bool IsPlacedOnSheet,
    List<ScheduleCatalogSheetPlacement> SheetPlacements
);

[ExportTsSchema]
public record ScheduleCoverageElementEntry(
    RevitElementHandle Element,
    List<ScheduleCoverageScheduleHit> MatchingSchedules
);

[ExportTsSchema]
public record ScheduleCoverageRoleSummary(
    string Role,
    int ScheduleCount,
    int CoveredElementCount,
    List<string> ScheduleNames
);

[ExportTsSchema]
public record ScheduleCoverageData(
    int TotalElements,
    int CoveredElements,
    int MissingElements,
    int ScheduleCount,
    List<ScheduleCoverageElementEntry> Elements,
    List<RevitDataIssue> Issues,
    RevitDataResultPage? Page = null,
    List<RevitElementHandle>? MissingHandles = null,
    List<string>? MatchedScheduleNames = null,
    List<ScheduleCoverageRoleSummary>? RoleSummaries = null
);

[ExportTsSchema]
public record ParameterCoverageRequest {
    public List<string> CategoryNames { get; init; } = [];
    public RevitElementScope Scope { get; init; } = RevitElementScope.All;
    public List<long> ElementIds { get; init; } = [];
    public List<string> ElementUniqueIds { get; init; } = [];
    public List<ParameterReference> Parameters { get; init; } = [];
    public RevitParameterLookupPreference LookupPreference { get; init; } = RevitParameterLookupPreference.InstanceThenType;
    public bool TreatWhitespaceAsBlank { get; init; } = true;
    public List<string> DefaultValues { get; init; } = [];
    public RevitDataOutputBudget? Budget { get; init; }
}

[ExportTsSchema]
public record ParameterCoverageParameterEntry(
    ParameterDefinitionDescriptor Definition,
    string? CategoryName,
    int ElementCount,
    int PresentCount,
    int MissingCount,
    int BlankCount,
    int DefaultCount,
    List<RevitElementHandle> Samples
) {
    public ParameterIdentity Identity => this.Definition.Identity;
}

[ExportTsSchema]
public record ParameterCoverageData(
    int TotalElements,
    List<ParameterCoverageParameterEntry> Parameters,
    List<RevitDataIssue> Issues,
    RevitDataResultPage? Page = null
);
