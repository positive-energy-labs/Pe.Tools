using Newtonsoft.Json;
using Newtonsoft.Json.Converters;
using TypeGen.Core.TypeAnnotations;

namespace Pe.Shared.RevitData;

[JsonConverter(typeof(StringEnumConverter))]
[ExportTsEnum]
public enum ProjectBrowserSection {
    Views,
    Sheets,
    Schedules
}

[JsonConverter(typeof(StringEnumConverter))]
[ExportTsEnum]
public enum ProjectBrowserResultView {
    Summary,
    Folders,
    Items
}

[JsonConverter(typeof(StringEnumConverter))]
[ExportTsEnum]
public enum ProjectBrowserMatchMode {
    Exact,
    Prefix
}

[ExportTsInterface]
public record ProjectBrowserFilter {
    public ProjectBrowserSection? Section { get; init; }
    public List<string> Path { get; init; } = [];
    public Dictionary<string, string> Fields { get; init; } = new(StringComparer.OrdinalIgnoreCase);
    public ProjectBrowserMatchMode MatchMode { get; init; } = ProjectBrowserMatchMode.Exact;
}

[ExportTsInterface]
public record ProjectBrowserRequest {
    public List<ProjectBrowserSection> Sections { get; init; } = [];
    public ProjectBrowserResultView View { get; init; } = ProjectBrowserResultView.Summary;
    public ProjectBrowserFilter? Filter { get; init; }
    public string? BrowserSnapshotId { get; init; }
    public RevitDataOutputBudget? Budget { get; init; }
}

[ExportTsInterface]
public record ProjectBrowserPathSegment(
    long? ParameterId,
    string? ParameterName,
    string FolderName
);

[ExportTsInterface]
public record ProjectBrowserPath(
    ProjectBrowserSection Section,
    string? OrganizationName,
    string PathLabel,
    List<ProjectBrowserPathSegment> Segments
);

[ExportTsInterface]
public record ProjectBrowserFolderSummary(
    ProjectBrowserSection Section,
    string? OrganizationName,
    string PathLabel,
    int ElementCount,
    List<RevitAgentContextHandle> SampleHandles
);

[ExportTsInterface]
public record ProjectBrowserItem(
    RevitAgentContextHandle Handle,
    ProjectBrowserPath BrowserPath,
    List<RevitAgentContextProvenance> Provenance
);

[ExportTsInterface]
public record ProjectBrowserNearestMatch(
    ProjectBrowserSection Section,
    string PathLabel,
    List<string> Path,
    int Score
);

[ExportTsInterface]
public record ProjectBrowserPathLevel(
    int Index,
    string? ParameterName,
    long? ParameterId,
    List<string> Values
);

[ExportTsInterface]
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

[ExportTsInterface]
public record ProjectBrowserData(
    string BrowserSnapshotId,
    ProjectBrowserResultView View,
    List<ProjectBrowserOrganizationSummary> Organizations,
    List<ProjectBrowserItem> Items,
    List<ProjectBrowserNearestMatch> NearestMatches,
    List<RevitDataIssue> Issues,
    RevitDataResultPage? Page = null
);
