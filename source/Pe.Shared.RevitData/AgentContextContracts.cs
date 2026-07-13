using Newtonsoft.Json;
using Newtonsoft.Json.Converters;

namespace Pe.Shared.RevitData;

[JsonConverter(typeof(StringEnumConverter))]
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
public enum RevitAgentVisibleContextScope {
    ActiveViewVisible,
    ViewReferences
}

[JsonConverter(typeof(StringEnumConverter))]
public enum RevitAgentVisibleProjection {
    Counts,
    Handles,
    Samples
}

[JsonConverter(typeof(StringEnumConverter))]
public enum RevitAgentViewRenderingScope {
    ActiveView,
    ViewReferences
}

public record RevitAgentContextHandle(
    RevitAgentContextHandleKind Kind,
    string DocumentKey,
    long? ElementId,
    string? UniqueId,
    string Label,
    string? CategoryName = null
);

public record RevitAgentContextProvenance(
    RevitAgentContextProvenanceKind Kind,
    string Description
);

public record RevitAgentViewSheetPlacement(
    RevitAgentContextHandle Sheet,
    string SheetNumber,
    string SheetName,
    bool IsActiveSheet
);

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

public record RevitAgentSelectionEntry(
    RevitAgentContextHandle Handle,
    string ClassName,
    string? FamilyName,
    string? TypeName,
    string? Mark,
    string? LevelName,
    List<RevitAgentContextProvenance> Provenance
);

public record RevitAgentSelectionContext(
    int SelectedElementCount,
    int ReturnedElementCount,
    List<RevitAgentSelectionEntry> Entries
);

public record RevitAgentVisibleElementSample(
    RevitAgentContextHandle Handle,
    string ClassName,
    string? FamilyName,
    string? TypeName,
    string? LevelName,
    List<RevitAgentContextProvenance>? Provenance = null,
    List<RevitAgentContextHandle>? VisibleInViews = null
);

public record RevitAgentVisibleElementHandle(
    RevitAgentContextHandle Handle,
    List<RevitAgentContextProvenance>? Provenance = null,
    List<RevitAgentContextHandle>? VisibleInViews = null
);

public record RevitAgentVisibleCategorySummary(
    RevitAgentContextHandle Handle,
    int ElementCount,
    List<RevitAgentVisibleElementSample> SampleElements,
    List<RevitAgentContextProvenance> Provenance,
    int ReturnedElementCount = 0,
    bool IsReturnedElementSetComplete = true,
    List<RevitAgentVisibleElementHandle>? ElementHandles = null
);

public record RevitAgentVisibleViewSummary(
    RevitAgentContextHandle Handle,
    string ViewType,
    string Title,
    int ElementCount,
    List<RevitAgentContextProvenance> Provenance
);

public record RevitAgentBrowserSummary(
    int ViewCount,
    int SheetCount,
    int ScheduleCount,
    int FamilyCount
);

public record RevitAgentContextSummaryData(
    RevitDocumentSessionContextData Documents,
    RevitAgentActiveViewContext? ActiveView,
    RevitAgentSelectionContext Selection,
    RevitAgentBrowserSummary Browser,
    List<RevitAgentVisibleCategorySummary> VisibleCategories
);

public record RevitAgentContextResolveRequest(
    string ReferenceText,
    int MaxResults = 10,
    List<RevitAgentContextHandleKind>? HandleKinds = null,
    bool RequirePrintedContext = false,
    int? MaxPerHandleKind = null,
    bool Compact = false
);

public record RevitAgentContextCandidate(
    RevitAgentContextHandle Handle,
    string Label,
    double Score,
    List<RevitAgentContextProvenance> Provenance,
    List<RevitAgentContextHandle> RelatedHandles
);

public record RevitAgentContextResolveData(
    string ReferenceText,
    int CandidateCount,
    List<RevitAgentContextCandidate> Candidates,
    List<RevitDataIssue> Issues
);

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

public record RevitAgentVisibleContextData(
    RevitAgentContextHandle? ActiveView,
    int TotalVisibleElementCount,
    List<RevitAgentVisibleCategorySummary> Categories,
    List<RevitDataIssue> Issues,
    List<RevitAgentVisibleViewSummary>? Views = null
);

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

public record RevitAgentView3DState(
    bool IsPerspective,
    bool? IsSectionBoxActive,
    bool? IsLocked,
    bool? HasSavedOrientation
);

public record RevitAgentViewFilterState(
    RevitAgentContextHandle Handle,
    bool? IsVisible,
    int? CategoryCount,
    string? ElementFilterType
);

public record RevitAgentHiddenCategoryState(
    RevitAgentContextHandle Handle,
    string? CategoryType
);

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

public record RevitAgentWorksetVisibilityState(
    string Name,
    long Id,
    string Visibility
);

public record RevitAgentViewRenderingStateData(
    RevitAgentContextHandle? ActiveView,
    List<RevitAgentObservedViewState> ObservedState,
    List<string> NotInspected,
    List<string> ApiLimitations,
    List<string> ConfidenceWarnings,
    List<string> LikelyInspectionNextSteps,
    List<RevitDataIssue> Issues
);

/// <summary>
///     What to capture. Omit entirely to capture the active view. Id/UniqueId accept a view,
///     sheet, viewport (dereferenced to its view), or schedule (must be placed on a sheet).
///     Name matches view name, sheet name, sheet number, or schedule name — exact first, then
///     unique substring. OnSheet (sheet number or name) disambiguates names that appear on
///     multiple sheets and selects which placement of a schedule to capture.
/// </summary>
public record RevitViewImageTarget(
    long? Id = null,
    string? UniqueId = null,
    string? Name = null,
    string? OnSheet = null
);

/// <summary>
///     Optional crop: exactly one of ElementIds, Selection, or ScopeBox. The view is exported
///     with a temporary crop box around the focus (rolled back afterwards), so graphics stay
///     exactly what the user sees. Requires an editable document; not supported on sheets.
/// </summary>
public record RevitViewImageFocus(
    List<long>? ElementIds = null,
    bool Selection = false,
    string? ScopeBox = null
);

public record RevitViewImageRequest(
    RevitViewImageTarget? Target = null,
    RevitViewImageFocus? Focus = null,
    double MarginPercent = 8,
    int PixelSize = 1500
);

/// <summary>Model-space XY extent covered by the exported image (feet), when known.</summary>
public record RevitViewImageModelRect(
    double MinX,
    double MinY,
    double MaxX,
    double MaxY
);

public record RevitViewImageData(
    RevitAgentContextHandle View,
    string FilePath,
    long ByteSize,
    int PixelSize,
    int? ViewScale = null,
    RevitViewImageModelRect? ModelRect = null,
    string? SheetNumber = null
);
