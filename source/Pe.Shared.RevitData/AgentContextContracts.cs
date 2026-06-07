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
    VisibleInReferencedView,
    PrintedContext,
    SearchMatch
}

[JsonConverter(typeof(StringEnumConverter))]
[ExportTsEnum]
public enum RevitAgentVisibleContextScope {
    ActiveViewVisible,
    ViewReferences
}

[JsonConverter(typeof(StringEnumConverter))]
[ExportTsEnum]
public enum RevitAgentVisibleProjection {
    Counts,
    Handles,
    Samples
}

[JsonConverter(typeof(StringEnumConverter))]
[ExportTsEnum]
public enum RevitAgentViewRenderingScope {
    ActiveView,
    ViewReferences
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
    string? LevelName,
    List<RevitAgentContextProvenance>? Provenance = null,
    List<RevitAgentContextHandle>? VisibleInViews = null
);

[ExportTsInterface]
public record RevitAgentVisibleElementHandle(
    RevitAgentContextHandle Handle,
    List<RevitAgentContextProvenance>? Provenance = null,
    List<RevitAgentContextHandle>? VisibleInViews = null
);

[ExportTsInterface]
public record RevitAgentVisibleCategorySummary(
    RevitAgentContextHandle Handle,
    int ElementCount,
    List<RevitAgentVisibleElementSample> SampleElements,
    List<RevitAgentContextProvenance> Provenance,
    int ReturnedElementCount = 0,
    bool IsReturnedElementSetComplete = true,
    List<RevitAgentVisibleElementHandle>? ElementHandles = null
);

[ExportTsInterface]
public record RevitAgentVisibleViewSummary(
    RevitAgentContextHandle Handle,
    string ViewType,
    string Title,
    int ElementCount,
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
    int MaxResults = 10,
    List<RevitAgentContextHandleKind>? HandleKinds = null,
    bool RequirePrintedContext = false,
    int? MaxPerHandleKind = null,
    bool Compact = false
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
    int MaxSampleElementsPerCategory = 0,
    RevitAgentVisibleContextScope Scope = RevitAgentVisibleContextScope.ActiveViewVisible,
    List<long>? ViewIds = null,
    List<string>? ViewUniqueIds = null,
    int MaxViews = 10,
    int MaxElementHandlesPerCategory = 0,
    bool ReturnElementHandlesOnly = false,
    RevitAgentVisibleProjection Projection = RevitAgentVisibleProjection.Counts
);

[ExportTsInterface]
public record RevitAgentVisibleContextData(
    RevitAgentContextHandle? ActiveView,
    int TotalVisibleElementCount,
    List<RevitAgentVisibleCategorySummary> Categories,
    List<RevitDataIssue> Issues,
    List<RevitAgentVisibleViewSummary>? Views = null
);

[ExportTsInterface]
public record RevitAgentViewRenderingStateRequest(
    RevitAgentViewRenderingScope Scope = RevitAgentViewRenderingScope.ActiveView,
    List<long>? ViewIds = null,
    List<string>? ViewUniqueIds = null,
    int MaxViews = 6,
    int MaxFiltersPerView = 60,
    int MaxHiddenCategoriesPerView = 40,
    int MaxLinksPerView = 25,
    int MaxWorksetsPerView = 40
);

[ExportTsInterface]
public record RevitAgentObservedViewState(
    RevitAgentContextHandle Handle,
    string ViewType,
    string Title,
    int Scale,
    string? LevelName,
    string? Discipline,
    string? DetailLevel,
    string? DisplayStyle,
    string? PhaseName,
    string? PhaseFilterName,
    string? ViewTemplateName,
    bool IsTemplate,
    bool CanBePrinted,
    bool AreGraphicsOverridesAllowed,
    bool? CropBoxActive,
    bool? CropBoxVisible,
    string? ScopeBoxName,
    bool? TemporaryHideIsolateActive,
    bool? PartsVisibilityShowOriginalOnly,
    RevitAgentPlanViewRangeState? PlanViewRange,
    RevitAgentView3DState? View3D,
    int CandidateVisibleElementCount,
    int ViewOwnedElementCount,
    List<RevitAgentViewFilterState> Filters,
    List<RevitAgentHiddenCategoryState> HiddenCategories,
    List<RevitAgentLinkRenderingState> Links,
    List<RevitAgentWorksetVisibilityState> Worksets,
    List<RevitAgentContextProvenance> Provenance
);

[ExportTsInterface]
public record RevitAgentPlanViewRangeState(
    string? TopLevelName,
    double? TopOffset,
    string? CutLevelName,
    double? CutOffset,
    string? BottomLevelName,
    double? BottomOffset,
    string? ViewDepthLevelName,
    double? ViewDepthOffset
);

[ExportTsInterface]
public record RevitAgentView3DState(
    bool IsPerspective,
    bool? IsSectionBoxActive,
    bool? IsLocked,
    bool? HasSavedOrientation
);

[ExportTsInterface]
public record RevitAgentViewFilterState(
    RevitAgentContextHandle Handle,
    bool? IsVisible,
    int? CategoryCount,
    string? ElementFilterType
);

[ExportTsInterface]
public record RevitAgentHiddenCategoryState(
    RevitAgentContextHandle Handle,
    string? CategoryType
);

[ExportTsInterface]
public record RevitAgentLinkRenderingState(
    RevitAgentContextHandle Handle,
    bool? IsHiddenInView,
    bool? IsLoaded,
    string? LinkVisibilityType,
    string? LinkedViewName,
    string? ObjectStyles,
    string? ViewFilterType,
    string? ViewRange,
    string? NestedLinks,
    string? PhaseName,
    string? PhaseFilterName,
    string? DetailLevel,
    string? Discipline
);

[ExportTsInterface]
public record RevitAgentWorksetVisibilityState(
    string Name,
    long Id,
    string Visibility
);

[ExportTsInterface]
public record RevitAgentViewRenderingStateData(
    RevitAgentContextHandle? ActiveView,
    List<RevitAgentObservedViewState> ObservedState,
    List<string> NotInspected,
    List<string> ApiLimitations,
    List<string> ConfidenceWarnings,
    List<string> LikelyInspectionNextSteps,
    List<RevitDataIssue> Issues
);
