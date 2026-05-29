using Newtonsoft.Json;
using Newtonsoft.Json.Converters;
using TypeGen.Core.TypeAnnotations;

namespace Pe.Shared.RevitData;

[JsonConverter(typeof(StringEnumConverter))]
[ExportTsEnum]
public enum RevitAgentContextHandleKind {
    Document,
    View,
    Sheet,
    Element,
    Schedule,
    Category,
    Family
}

[JsonConverter(typeof(StringEnumConverter))]
[ExportTsEnum]
public enum RevitAgentContextProvenanceKind {
    ActiveDocument,
    OpenDocument,
    ActiveView,
    CurrentSelection,
    ExplicitReference,
    SheetPlacement,
    BrowserIndex,
    VisibleInActiveView,
    PrintedContext,
    SearchMatch
}

[ExportTsInterface]
public record RevitAgentContextHandle(
    RevitAgentContextHandleKind Kind,
    string DocumentKey,
    long? ElementId,
    string? UniqueId,
    string Label,
    string? CategoryName = null
);

[ExportTsInterface]
public record RevitAgentContextProvenance(
    RevitAgentContextProvenanceKind Kind,
    string Description
);

[ExportTsInterface]
public record RevitAgentViewSheetPlacement(
    RevitAgentContextHandle Sheet,
    string SheetNumber,
    string SheetName,
    bool IsActiveSheet
);

[ExportTsInterface]
public record RevitAgentActiveViewContext(
    RevitAgentContextHandle Handle,
    string ViewType,
    string Title,
    int Scale,
    string? LevelName,
    string? Discipline,
    string? PhaseName,
    string? ViewTemplateName,
    bool IsTemplate,
    bool CanBePrinted,
    bool IsSheet,
    bool IsSchedule,
    List<RevitAgentViewSheetPlacement> SheetPlacements,
    List<RevitAgentContextProvenance> Provenance
);

[ExportTsInterface]
public record RevitAgentSelectionEntry(
    RevitAgentContextHandle Handle,
    string ClassName,
    string? FamilyName,
    string? TypeName,
    string? Mark,
    string? LevelName,
    List<RevitAgentContextProvenance> Provenance
);

[ExportTsInterface]
public record RevitAgentSelectionContext(
    int SelectedElementCount,
    int ReturnedElementCount,
    List<RevitAgentSelectionEntry> Entries
);

[ExportTsInterface]
public record RevitAgentVisibleElementSample(
    RevitAgentContextHandle Handle,
    string ClassName,
    string? FamilyName,
    string? TypeName,
    string? LevelName
);

[ExportTsInterface]
public record RevitAgentVisibleCategorySummary(
    RevitAgentContextHandle Handle,
    int ElementCount,
    List<RevitAgentVisibleElementSample> SampleElements,
    List<RevitAgentContextProvenance> Provenance
);

[ExportTsInterface]
public record RevitAgentBrowserSummary(
    int ViewCount,
    int SheetCount,
    int ScheduleCount,
    int FamilyCount
);

[ExportTsInterface]
public record RevitAgentContextSummaryData(
    RevitDocumentSessionContextData Documents,
    RevitAgentActiveViewContext? ActiveView,
    RevitAgentSelectionContext Selection,
    RevitAgentBrowserSummary Browser,
    List<RevitAgentVisibleCategorySummary> VisibleCategories
);

[ExportTsInterface]
public record RevitAgentContextResolveRequest(
    string ReferenceText,
    int MaxResults = 10
);

[ExportTsInterface]
public record RevitAgentContextCandidate(
    RevitAgentContextHandle Handle,
    string Label,
    double Score,
    List<RevitAgentContextProvenance> Provenance,
    List<RevitAgentContextHandle> RelatedHandles
);

[ExportTsInterface]
public record RevitAgentContextResolveData(
    string ReferenceText,
    int CandidateCount,
    List<RevitAgentContextCandidate> Candidates,
    List<RevitDataIssue> Issues
);

[ExportTsInterface]
public record RevitAgentVisibleContextRequest(
    int MaxCategories = 12,
    List<string>? CategoryNames = null,
    int MaxSampleElementsPerCategory = 0
);

[ExportTsInterface]
public record RevitAgentVisibleContextData(
    RevitAgentContextHandle? ActiveView,
    int TotalVisibleElementCount,
    List<RevitAgentVisibleCategorySummary> Categories,
    List<RevitDataIssue> Issues
);
