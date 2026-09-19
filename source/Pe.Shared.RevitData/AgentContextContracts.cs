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

// Limits are nullable so an omitted field survives any deserializer as "unset"
// (constructor defaults are lost on some wire paths and 0 would clamp to the
// minimum, silently under-reporting). Collectors substitute the generous
// defaults documented per field; only explicit out-of-range values warn.
public record RevitAgentVisibleContextRequest(
    // default 12
    int? MaxCategories = null,
    List<string>? CategoryNames = null,
    // default 0
    int? MaxSampleElementsPerCategory = null,
    RevitAgentVisibleContextScope Scope = RevitAgentVisibleContextScope.ActiveViewVisible,
    List<long>? ViewIds = null,
    List<string>? ViewUniqueIds = null,
    // default 10
    int? MaxViews = null,
    // default 0
    int? MaxElementHandlesPerCategory = null,
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

// Nullable limits for the same reason as RevitAgentVisibleContextRequest:
// omitted must mean "use the generous default", never "clamp to minimum".
public record RevitAgentViewRenderingStateRequest(
    RevitAgentViewRenderingScope Scope = RevitAgentViewRenderingScope.ActiveView,
    List<long>? ViewIds = null,
    List<string>? ViewUniqueIds = null,
    // default 6
    int? MaxViews = null,
    // default 60
    int? MaxFiltersPerView = null,
    // default 40
    int? MaxHiddenCategoriesPerView = null,
    // default 25
    int? MaxLinksPerView = null,
    // default 40
    int? MaxWorksetsPerView = null
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

/// <summary>Axis-aligned model-space XY bounds (feet) of the view's crop, when known. Not a pixel mapping on a
///     rotated crop; use <see cref="RevitViewImageRegistration" /> to place pixels.</summary>
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
    string? SheetNumber = null,
    RevitViewImageRegistration? Registration = null,
    // Why Registration is absent; null exactly when it is present.
    RevitViewImageRegistrationRefusal? RegistrationRefusal = null
) {
    /// <summary>
    ///     Host route for exactly the registered PNG, keyed by <see cref="RevitViewImageRegistration.ImageSha256" />;
    ///     null exactly when <see cref="Registration" /> is. <see cref="FilePath" /> stays the host-side record.
    /// </summary>
    public string? ImageUrl => this.Registration is null ? null : $"/view-image/{this.Registration.ImageSha256}.png";
}

/// <summary>Why a view image carries no <see cref="RevitViewImageRegistration" />.</summary>
[JsonConverter(typeof(StringEnumConverter))]
public enum RevitViewImageRegistrationRefusal {
    /// <summary>A sheet, a sheeted schedule, or a view without an active crop: nothing to register against.</summary>
    NoCrop,
    /// <summary>The exported PNG was not found.</summary>
    NoImage,
    /// <summary>The crop or the image has no area.</summary>
    DegenerateCrop,
    /// <summary>The image's aspect disagrees with the crop's, so the PNG is not exactly the crop; refused, not stretched.</summary>
    AspectDisagrees
}

/// <summary>
///     Where the PNG sits in the model: model XY (feet) of the image's top-left, top-right and bottom-left pixel
///     corners, so a rotated crop stays honest. <see cref="ImageSha256" /> binds it to exactly this file.
///     When absent, <see cref="RevitViewImageData.RegistrationRefusal" /> says why.
/// </summary>
public record RevitViewImageRegistration(
    int Width,
    int Height,
    string ImageSha256,
    double[] TopLeft,
    double[] TopRight,
    double[] BottomLeft
) {
    /// <summary>
    ///     Crop min/max are in the crop box's own frame; origin and bases are its transform projected to model XY.
    ///     The image's X runs along basisX and its up along basisY, so top-left is (min.X, max.Y).
    /// </summary>
    public static (RevitViewImageRegistration? Registration, RevitViewImageRegistrationRefusal? Refusal) FromCrop(
        int width, int height, string imageSha256,
        (double X, double Y) min, (double X, double Y) max,
        (double X, double Y) origin, (double X, double Y) basisX, (double X, double Y) basisY
    ) {
        double cropW = max.X - min.X, cropH = max.Y - min.Y;
        if (width <= 0 || height <= 0 || cropW <= 0 || cropH <= 0) return (null, RevitViewImageRegistrationRefusal.DegenerateCrop);
        // ponytail: aspect agreement is the only check that the PNG covers exactly this extent; an extent shifted
        // without changing its aspect (e.g. annotations past a crop with annotation crop off) would slip through.
        var expectedHeight = width * cropH / cropW;
        if (Math.Abs(height - expectedHeight) > Math.Max(2, expectedHeight * 0.005))
            return (null, RevitViewImageRegistrationRefusal.AspectDisagrees);
        double[] Model(double x, double y) => [
            origin.X + x * basisX.X + y * basisY.X,
            origin.Y + x * basisX.Y + y * basisY.Y
        ];
        return (new RevitViewImageRegistration(width, height, imageSha256,
            Model(min.X, max.Y), Model(max.X, max.Y), Model(min.X, min.Y)), null);
    }
}
