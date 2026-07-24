namespace Pe.Shared.RevitData;

// glance.* ops are the first-class composed "question" tier: one bounded,
// pre-digested packet per recurring agent question, built from summaries the
// document already answers cheaply — never from budget-truncated row lists.
// Promoted from the client-side glance.model prototype in apps/web/src/ops/glance/.
//
// Envelope law (docs/adr/0003): ObservedAtUtc stamped Revit-side, complete-by-
// construction summaries (no truncation dialects), Issues for anything partial.

public sealed record GlanceLevelEntry(
    string Name,
    double ElevationFeet
);

/// <summary>
///     Sheet-number first-letter series counts (M/E/P/...). Discipline is not a
///     document fact the Revit API exposes; these are the inference inputs, and any
///     discipline claim derived from them must be labeled inferred.
/// </summary>
public sealed record GlanceSheetSeriesEntry(
    string Prefix,
    int SheetCount
);

public sealed record GlanceCategoryFamilyCount(
    string CategoryName,
    int FamilyCount
);

/// <summary>
///     One bounded "what is on the user's screen, and can pea trust it" packet:
///     active-view identity, observed view state, visible composition (counts only),
///     and the trust strip (confidence warnings / API limitations / not-inspected)
///     quoted verbatim. Promoted from the client-side glance.attention prototype.
/// </summary>
public sealed record GlanceAttentionData(
    string ObservedAtUtc,
    RevitAgentActiveViewContext? ActiveView,
    RevitAgentObservedViewState? ViewState,
    int TotalVisibleElementCount,
    List<RevitAgentVisibleCategorySummary> VisibleCategories,
    List<string> ConfidenceWarnings,
    List<string> ApiLimitations,
    List<string> NotInspected,
    List<RevitDataIssue> Issues
);

public sealed record GlanceModelData(
    string ObservedAtUtc,
    RevitDocumentSummary Document,
    RevitAgentBrowserSummary ProjectTotals,
    List<GlanceLevelEntry> Levels,
    List<GlanceSheetSeriesEntry> SheetNumberSeries,
    LoadedFamiliesCatalogSummary Families,
    List<GlanceCategoryFamilyCount> FamiliesByCategory,
    ProjectParameterBindingsSummary Bindings,
    List<RevitDataIssue> Issues
);
