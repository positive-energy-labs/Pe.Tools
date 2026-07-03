using Newtonsoft.Json;
using Newtonsoft.Json.Converters;
using Pe.Shared.Codegen;

namespace Pe.Shared.RevitData;

[JsonConverter(typeof(StringEnumConverter))]
[ExportTsSchema]
public enum ProjectBrowserSection {
    Views,
    Sheets,
    Schedules
}

[JsonConverter(typeof(StringEnumConverter))]
[ExportTsSchema]
public enum ProjectBrowserResultView {
    Summary,
    Folders,
    Items
}

[JsonConverter(typeof(StringEnumConverter))]
[ExportTsSchema]
public enum ProjectBrowserMatchMode {
    Exact,
    Prefix
}

[ExportTsSchema]
public record ProjectBrowserFilter {
    public ProjectBrowserSection? Section { get; init; }
    public List<string> Path { get; init; } = [];
    public Dictionary<string, string> Fields { get; init; } = new(StringComparer.OrdinalIgnoreCase);
    public ProjectBrowserMatchMode MatchMode { get; init; } = ProjectBrowserMatchMode.Exact;
}

[ExportTsSchema]
public record ProjectBrowserRequest {
    public List<ProjectBrowserSection> Sections { get; init; } = [];
    public ProjectBrowserResultView View { get; init; } = ProjectBrowserResultView.Summary;
    public ProjectBrowserFilter? Filter { get; init; }
    public string? BrowserSnapshotId { get; init; }
    public RevitDataOutputBudget? Budget { get; init; }
}

[ExportTsSchema]
public record ProjectBrowserPathSegment(
    long? ParameterId,
    string? ParameterName,
    string FolderName
);

[ExportTsSchema]
public record ProjectBrowserPath(
    ProjectBrowserSection Section,
    string? OrganizationName,
    string PathLabel,
    List<ProjectBrowserPathSegment> Segments
);

[ExportTsSchema]
public record ProjectBrowserFolderSummary(
    ProjectBrowserSection Section,
    string? OrganizationName,
    string PathLabel,
    int ElementCount,
    List<RevitAgentContextHandle> SampleHandles
);

[ExportTsSchema]
public record ProjectBrowserItem(
    RevitAgentContextHandle Handle,
    ProjectBrowserPath BrowserPath,
    List<RevitAgentContextProvenance> Provenance
);

[ExportTsSchema]
public record ProjectBrowserNearestMatch(
    ProjectBrowserSection Section,
    string PathLabel,
    List<string> Path,
    int Score
);

[ExportTsSchema]
public record ProjectBrowserPathLevel(
    int Index,
    string? ParameterName,
    long? ParameterId,
    List<string> Values
);

[ExportTsSchema]
public record ProjectBrowserOrganizationSummary(
    ProjectBrowserSection Section,
    string? OrganizationName,
    long? SortingParameterId,
    string? SortingParameterName,
    string? SortingOrder,
    int IndexedElementCount,
    int FolderCount,
    List<ProjectBrowserPathLevel> PathLevels,
    List<ProjectBrowserFolderSummary> Folders
);

[ExportTsSchema]
public record ProjectBrowserData(
    string BrowserSnapshotId,
    ProjectBrowserResultView View,
    List<ProjectBrowserOrganizationSummary> Organizations,
    List<ProjectBrowserItem> Items,
    List<ProjectBrowserNearestMatch> NearestMatches,
    List<RevitDataIssue> Issues,
    RevitDataResultPage? Page = null
);
