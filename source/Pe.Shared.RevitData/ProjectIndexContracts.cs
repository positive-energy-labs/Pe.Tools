using Newtonsoft.Json;
using Newtonsoft.Json.Converters;

namespace Pe.Shared.RevitData;

[JsonConverter(typeof(StringEnumConverter))]
public enum ProjectIndexSection {
    Levels,
    Sheets,
    Views,
    Schedules,
    Categories,
    Families
}

public record ProjectIndexRequest {
    public List<ProjectIndexSection> Sections { get; init; } = [];
    public string? SearchText { get; init; }
    public List<string> LevelNames { get; init; } = [];
    public List<string> SheetNumberContains { get; init; } = [];
    public List<string> SheetNameContains { get; init; } = [];
    public List<string> CategoryNames { get; init; } = [];
    public List<string> FamilyNameContains { get; init; } = [];
    public List<string> ScheduleNameContains { get; init; } = [];
    public bool IncludeUnplacedViews { get; init; } = false;
    public bool IncludeUnplacedSchedules { get; init; } = false;
    public bool IncludeBrowserProvenance { get; init; } = false;
    public bool IncludeModelContext { get; init; } = false;
    public ProjectBrowserFilter? BrowserFilter { get; init; }
    public List<ProjectBrowserSection> BrowserSections { get; init; } = [];
    public RevitDataProjectionRequest? Projection { get; init; }
    public RevitDataOutputBudget? Budget { get; init; }
}

public record ProjectIndexSummary(
    int LevelCount,
    int SheetCount,
    int ViewCount,
    int ScheduleCount,
    int CategoryCount,
    int FamilyCount,
    bool Truncated
);

public record ProjectIndexLevelEntry(
    RevitAgentContextHandle Handle,
    string Name,
    double Elevation,
    int ViewCount,
    int PlacedViewCount,
    int ScheduleCount,
    int PlacedScheduleCount,
    int FamilyInstanceCount,
    List<RevitAgentContextHandle> SheetHandles,
    List<RevitAgentContextProvenance> Provenance
);

public record ProjectIndexSheetEntry(
    RevitAgentContextHandle Handle,
    string SheetNumber,
    string SheetName,
    int PlacedViewCount,
    int PlacedScheduleCount,
    List<RevitAgentContextHandle> PlacedViews,
    List<RevitAgentContextHandle> PlacedSchedules,
    List<string> LevelNames,
    List<ProjectBrowserPath> BrowserPaths,
    List<RevitAgentContextProvenance> Provenance
);

public record ProjectIndexViewEntry(
    RevitAgentContextHandle Handle,
    string Name,
    string ViewType,
    string? LevelName,
    bool IsTemplate,
    bool CanBePrinted,
    bool IsPlacedOnSheet,
    List<RevitAgentContextHandle> SheetHandles,
    List<ProjectBrowserPath> BrowserPaths,
    List<RevitAgentContextProvenance> Provenance
);

public record ProjectIndexScheduleEntry(
    RevitAgentContextHandle Handle,
    string Name,
    string? CategoryName,
    bool IsTemplate,
    bool IsPlacedOnSheet,
    bool FilterBySheet,
    int VisibleBodyRowCount,
    int VisibleFamilyCount,
    int VisibleInstanceCount,
    List<RevitAgentContextHandle> SheetHandles,
    List<string> FieldNames,
    List<ProjectBrowserPath> BrowserPaths,
    List<RevitAgentContextProvenance> Provenance
);

public record ProjectIndexCategoryEntry(
    RevitAgentContextHandle Handle,
    string CategoryName,
    int FamilyCount,
    int PlacedInstanceCount,
    int ScheduleCount,
    List<RevitAgentContextHandle> ScheduleHandles,
    List<RevitAgentContextProvenance> Provenance
);

public record ProjectIndexFamilyEntry(
    RevitAgentContextHandle Handle,
    string FamilyName,
    string? CategoryName,
    int TypeCount,
    int PlacedInstanceCount,
    int ScheduleCount,
    List<RevitAgentContextHandle> ScheduleHandles,
    List<RevitAgentContextProvenance> Provenance
);

public record ProjectIndexModelCategoryCount(
    string CategoryName,
    int ElementCount
);

public record ProjectIndexModelContext(
    int LinkCount,
    int RoomCount,
    int SpaceCount,
    int AreaCount,
    List<ProjectIndexModelCategoryCount> MajorCategoryCounts
);

public record ProjectIndexData(
    ProjectIndexSummary Summary,
    List<ProjectIndexLevelEntry> Levels,
    List<ProjectIndexSheetEntry> Sheets,
    List<ProjectIndexViewEntry> Views,
    List<ProjectIndexScheduleEntry> Schedules,
    List<ProjectIndexCategoryEntry> Categories,
    List<ProjectIndexFamilyEntry> Families,
    List<ProjectBrowserOrganizationSummary> BrowserOrganizations,
    ProjectIndexModelContext? ModelContext,
    List<RevitDataIssue> Issues,
    RevitDataResultPage? Page = null
);
