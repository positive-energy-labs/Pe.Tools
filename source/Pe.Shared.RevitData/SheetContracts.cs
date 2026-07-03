using Newtonsoft.Json;
using Newtonsoft.Json.Converters;
using Pe.Shared.Codegen;

namespace Pe.Shared.RevitData;

[JsonConverter(typeof(StringEnumConverter))]
[ExportTsSchema]
public enum SheetDetailView {
    Summary,
    Anchors,
    Text
}

[JsonConverter(typeof(StringEnumConverter))]
[ExportTsSchema]
public enum SheetAnchorKind {
    TitleBlock,
    Viewport,
    ScheduleInstance,
    TextNote,
    GenericAnnotation,
    RasterImage,
    ImportInstance
}

[ExportTsSchema]
public record SheetReferenceRequest {
    public List<string> SheetNumbers { get; init; } = [];
    public List<string> SheetNumberContains { get; init; } = [];
    public List<long> SheetIds { get; init; } = [];
    public List<string> SheetUniqueIds { get; init; } = [];
    public bool CurrentActiveSheet { get; init; } = false;
}

[ExportTsSchema]
public record SheetDetailProjection {
    public SheetDetailView View { get; init; } = SheetDetailView.Summary;
    public bool IncludeTitleBlocks { get; init; } = true;
    public bool IncludeViewports { get; init; } = true;
    public bool IncludeScheduleInstances { get; init; } = true;
    public bool IncludeTextNotes { get; init; } = false;
    public bool IncludeAnnotations { get; init; } = false;
    public bool IncludeBoundingBoxes { get; init; } = true;
    public bool IncludeTitleBlockParameters { get; init; } = false;
}

[ExportTsSchema]
public record SheetDetailRequest {
    public SheetReferenceRequest? References { get; init; }
    public SheetDetailProjection? Projection { get; init; }
    public RevitDataOutputBudget? Budget { get; init; }
}

[ExportTsSchema]
public record SheetBounds(double MinX, double MinY, double MaxX, double MaxY);

[ExportTsSchema]
public record SheetAnchor(
    SheetAnchorKind Kind,
    RevitAgentContextHandle Handle,
    string Label,
    SheetBounds? Bounds,
    RevitAgentContextHandle? TargetHandle,
    string? Text,
    Dictionary<string, string> Parameters,
    List<RevitAgentContextProvenance> Provenance
);

[ExportTsSchema]
public record SheetSummary(
    RevitAgentContextHandle Handle,
    string SheetNumber,
    string SheetName,
    int TitleBlockCount,
    int ViewportCount,
    int ScheduleInstanceCount,
    int TextNoteCount,
    int GenericAnnotationCount,
    int RasterImageCount,
    int ImportInstanceCount,
    List<ProjectBrowserPath> BrowserPaths
);

[ExportTsSchema]
public record SheetDetailEntry(
    SheetSummary Summary,
    List<SheetAnchor> Anchors,
    List<RevitDataIssue> Issues
);

[ExportTsSchema]
public record SheetDetailData(
    List<SheetDetailEntry> Sheets,
    RevitDataResultPage Page,
    List<RevitDataIssue> Issues
);
