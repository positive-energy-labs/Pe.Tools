using Pe.Shared.RevitData;
using Serilog;
using System.Diagnostics;

namespace Pe.Revit.DocumentData.AgentContext;

public static class RevitAgentContextCollector {
    private static readonly StringComparer IgnoreCase = StringComparer.OrdinalIgnoreCase;

    private sealed record VisibleContextView(
        View View,
        List<RevitAgentContextProvenance> Provenance
    );

    private sealed record VisibleElementEntry(
        Element Element,
        VisibleContextView VisibleView
    );

    private sealed record VisibleCategoryCollectorFilter(
        HashSet<string> RequestedNames,
        List<ElementId> CategoryIds,
        int DocumentCategoryCount
    );

    public static RevitAgentContextSummaryData CollectSummary(
        Document document,
        RevitDocumentSessionContextData documents,
        View? activeView,
        IReadOnlyCollection<ElementId>? currentSelection
    ) => new(
        documents,
        activeView == null ? null : CreateActiveViewContext(document, activeView),
        CreateSelectionContext(document, currentSelection, 12),
        CreateBrowserSummary(document),
        activeView == null ? [] : CollectVisibleCategories(document, activeView, 8, [], [], 0)
    );

    public static RevitAgentVisibleContextData CollectVisibleContext(
        Document document,
        View? activeView,
        RevitAgentVisibleContextRequest request
    ) {
        var issues = new List<RevitDataIssue>();
        var maxCategories = BoundRequestedCount(
            request.MaxCategories,
            1,
            50,
            nameof(RevitAgentVisibleContextRequest.MaxCategories),
            issues
        );
        var maxSampleElements = BoundRequestedCount(
            request.MaxSampleElementsPerCategory,
            0,
            12,
            nameof(RevitAgentVisibleContextRequest.MaxSampleElementsPerCategory),
            issues
        );
        var returnHandlesOnly = request.ReturnElementHandlesOnly || request.Projection == RevitAgentVisibleProjection.Handles;
        var returnSamples = request.Projection == RevitAgentVisibleProjection.Samples;
        var maxElementHandles = BoundRequestedCount(
            request.MaxElementHandlesPerCategory,
            0,
            1000,
            nameof(RevitAgentVisibleContextRequest.MaxElementHandlesPerCategory),
            issues
        );
        if (returnHandlesOnly && maxElementHandles == 0)
            maxElementHandles = 1000;
        if (!returnSamples)
            maxSampleElements = 0;
        var maxViews = BoundRequestedCount(
            request.MaxViews,
            1,
            25,
            nameof(RevitAgentVisibleContextRequest.MaxViews),
            issues
        );
        var visibleViews = ResolveVisibleContextViews(document, activeView, request, maxViews, issues);
        if (visibleViews.Count == 0) {
            return new RevitAgentVisibleContextData(
                activeView == null ? null : CreateHandle(document, activeView, RevitAgentContextHandleKind.View, activeView.Title),
                0,
                [],
                issues,
                []
            );
        }

        var categoryFilter = CreateVisibleCategoryCollectorFilter(document, request.CategoryNames ?? []);
        var visibleEntries = CollectVisibleEntries(document, visibleViews, categoryFilter, issues);
        var categories = CreateVisibleCategories(
            document,
            visibleEntries,
            visibleViews,
            maxCategories,
            issues,
            request.CategoryNames ?? [],
            returnHandlesOnly ? maxElementHandles : Math.Max(maxSampleElements, maxElementHandles),
            returnHandlesOnly
        );
        var viewSummaries = CreateVisibleViewSummaries(document, visibleViews, visibleEntries);
        return new RevitAgentVisibleContextData(
            activeView == null ? null : CreateHandle(document, activeView, RevitAgentContextHandleKind.View, activeView.Title),
            categories.Sum(category => category.ElementCount),
            categories,
            issues,
            viewSummaries
        );
    }

    public static RevitAgentContextResolveData Resolve(
        Document document,
        View? activeView,
        IReadOnlyCollection<ElementId>? currentSelection,
        RevitAgentContextResolveRequest request
    ) {
        var issues = new List<RevitDataIssue>();
        var referenceText = request.ReferenceText?.Trim() ?? string.Empty;
        var tokens = Tokenize(referenceText);
        if (tokens.Count == 0) {
            issues.Add(new RevitDataIssue(
                "AgentContextReferenceRequired",
                RevitDataIssueSeverity.Warning,
                "Reference text is required.",
                TypeName: nameof(RevitAgentContextResolveRequest)
            ));
            return new RevitAgentContextResolveData(referenceText, 0, [], issues);
        }

        var totalStopwatch = Stopwatch.StartNew();
        var allowedKinds = (request.HandleKinds ?? [])
            .Distinct()
            .ToHashSet();
        var filterByKind = allowedKinds.Count != 0;
        var candidates = new List<RevitAgentContextCandidate>();
        if (activeView != null && (!filterByKind || allowedKinds.Contains(RevitAgentContextHandleKind.View) || allowedKinds.Contains(RevitAgentContextHandleKind.Sheet)))
            candidates.AddRange(TimePhase("active-view", () => CreateActiveViewCandidates(document, activeView, tokens).ToList()));
        else if (activeView != null)
            Log.Debug("RevitAgentContext resolve skipped active-view source because requested handle kinds excluded views and sheets");

        if (!request.RequirePrintedContext && (!filterByKind || allowedKinds.Contains(RevitAgentContextHandleKind.Element)))
            candidates.AddRange(TimePhase("selection", () => CreateSelectionCandidates(document, currentSelection, tokens).ToList()));
        else
            Log.Debug("RevitAgentContext resolve skipped selection source because printed context or handle kind filters excluded elements");

        if (!filterByKind || allowedKinds.Overlaps([RevitAgentContextHandleKind.View, RevitAgentContextHandleKind.Sheet, RevitAgentContextHandleKind.Family]))
            candidates.AddRange(TimePhase("browser", () => CreateBrowserCandidates(document, tokens, allowedKinds, request.RequirePrintedContext).ToList()));
        else
            Log.Debug("RevitAgentContext resolve skipped browser source because requested handle kinds excluded browser-backed handles");

        var maxResults = Clamp(request.MaxResults, 1, 50);
        var maxPerHandleKind = request.MaxPerHandleKind is > 0 ? Clamp(request.MaxPerHandleKind.Value, 1, 50) : (int?)null;
        var filteredCandidates = candidates
            .Where(candidate => candidate.Score > 0)
            .Where(candidate => !filterByKind || allowedKinds.Contains(candidate.Handle.Kind))
            .Where(candidate => !request.RequirePrintedContext || IsPrintedContextCandidate(candidate));
        var dedupedCandidates = filteredCandidates
            .GroupBy(candidate => $"{candidate.Handle.Kind}:{candidate.Handle.DocumentKey}:{candidate.Handle.ElementId}:{candidate.Handle.UniqueId}")
            .Select(group => group.OrderByDescending(candidate => candidate.Score).First());
        if (maxPerHandleKind != null) {
            dedupedCandidates = dedupedCandidates
                .GroupBy(candidate => candidate.Handle.Kind)
                .SelectMany(group => group
                    .OrderByDescending(candidate => candidate.Score)
                    .ThenBy(candidate => candidate.Label, IgnoreCase)
                    .Take(maxPerHandleKind.Value));
        }

        var results = dedupedCandidates
            .OrderByDescending(candidate => candidate.Score)
            .ThenBy(candidate => candidate.Label, IgnoreCase)
            .Take(maxResults)
            .Select(candidate => request.Compact ? CompactCandidate(candidate) : candidate)
            .ToList();

        if (results.Count == 0) {
            issues.Add(new RevitDataIssue(
                "AgentContextNoCandidates",
                RevitDataIssueSeverity.Info,
                $"No Revit context candidates matched '{referenceText}'.",
                TypeName: nameof(RevitAgentContextCandidate)
            ));
        }

        Log.Debug("RevitAgentContext resolve completed in {ElapsedMilliseconds} ms with {CandidateCount} raw candidate(s) and {ResultCount} result(s)", totalStopwatch.ElapsedMilliseconds, candidates.Count, results.Count);
        return new RevitAgentContextResolveData(referenceText, results.Count, results, issues);
    }

    private static RevitAgentActiveViewContext CreateActiveViewContext(Document document, View view) =>
        CreateActiveViewContext(document, view, CreateSheetPlacementIndex(document));

    private static RevitAgentActiveViewContext CreateActiveViewContext(
        Document document,
        View view,
        SheetPlacementIndex placementIndex
    ) => new(
        CreateHandle(document, view, RevitAgentContextHandleKind.View, view.Title),
        view.ViewType.ToString(),
        view.Title,
        view.Scale,
        view.GenLevel?.Name,
        TryRead(() => view.Discipline.ToString()),
        TryReadPhaseName(document, view),
        TryReadViewTemplateName(document, view),
        view.IsTemplate,
        view.CanBePrinted,
        view is ViewSheet,
        view is ViewSchedule,
        FindSheetPlacements(document, view, placementIndex).Take(8).ToList(),
        [new RevitAgentContextProvenance(RevitAgentContextProvenanceKind.ActiveView, "Current active Revit view.")]
    );

    private static RevitAgentSelectionContext CreateSelectionContext(
        Document document,
        IReadOnlyCollection<ElementId>? currentSelection,
        int maxEntries
    ) {
        var selectionIds = currentSelection?.ToList() ?? [];
        var entries = selectionIds
            .Select(document.GetElement)
            .Where(element => element != null)
            .Take(maxEntries)
            .Select(element => CreateSelectionEntry(document, element!))
            .ToList();
        return new RevitAgentSelectionContext(selectionIds.Count, entries.Count, entries);
    }

    private static RevitAgentSelectionEntry CreateSelectionEntry(Document document, Element element) {
        var family = element as FamilyInstance;
        return new RevitAgentSelectionEntry(
            CreateHandle(document, element, RevitAgentContextHandleKind.Element, CreateElementLabel(element, family)),
            element.GetType().Name,
            family?.Symbol?.Family?.Name,
            family?.Symbol?.Name,
            ReadMark(element),
            GetLevelName(document, element),
            [new RevitAgentContextProvenance(RevitAgentContextProvenanceKind.CurrentSelection, "Element is in the current Revit selection.")]
        );
    }

    private static RevitAgentVisibleElementSample CreateVisibleElementSample(
        Document document,
        Element element,
        IReadOnlyCollection<VisibleContextView>? visibleViews = null
    ) {
        var family = element as FamilyInstance;
        var viewHandles = (visibleViews ?? [])
            .Select(visibleView => CreateHandle(document, visibleView.View, RevitAgentContextHandleKind.View, visibleView.View.Title))
            .GroupBy(handle => $"{handle.DocumentKey}:{handle.ElementId}:{handle.UniqueId}")
            .Select(group => group.First())
            .ToList();
        var provenance = (visibleViews ?? [])
            .Select(visibleView => new RevitAgentContextProvenance(
                visibleView.Provenance.Any(item => item.Kind == RevitAgentContextProvenanceKind.ActiveView)
                    ? RevitAgentContextProvenanceKind.VisibleInActiveView
                    : RevitAgentContextProvenanceKind.VisibleInReferencedView,
                $"Element is visible in view '{visibleView.View.Title}'."
            ))
            .ToList();

        return new RevitAgentVisibleElementSample(
            CreateHandle(document, element, RevitAgentContextHandleKind.Element, CreateElementLabel(element, family)),
            element.GetType().Name,
            family?.Symbol?.Family?.Name,
            family?.Symbol?.Name,
            GetLevelName(document, element),
            provenance,
            viewHandles
        );
    }


    private static RevitAgentVisibleElementHandle CreateVisibleElementHandle(
        Document document,
        Element element,
        IReadOnlyCollection<VisibleContextView>? visibleViews = null
    ) {
        var viewHandles = (visibleViews ?? [])
            .Select(visibleView => CreateHandle(document, visibleView.View, RevitAgentContextHandleKind.View, visibleView.View.Title))
            .GroupBy(handle => $"{handle.DocumentKey}:{handle.ElementId}:{handle.UniqueId}")
            .Select(group => group.First())
            .ToList();
        var provenance = (visibleViews ?? [])
            .Select(visibleView => new RevitAgentContextProvenance(
                visibleView.Provenance.Any(item => item.Kind == RevitAgentContextProvenanceKind.ActiveView)
                    ? RevitAgentContextProvenanceKind.VisibleInActiveView
                    : RevitAgentContextProvenanceKind.VisibleInReferencedView,
                $"Element is visible in view '{visibleView.View.Title}'."
            ))
            .ToList();

        return new RevitAgentVisibleElementHandle(
            CreateHandle(document, element, RevitAgentContextHandleKind.Element, $"{element.Category?.Name ?? element.GetType().Name} {element.Id.Value()}"),
            provenance,
            viewHandles
        );
    }

    private static RevitAgentBrowserSummary CreateBrowserSummary(Document document) => new(
        new FilteredElementCollector(document).OfClass(typeof(View)).Cast<View>().Count(view => !view.IsTemplate),
        new FilteredElementCollector(document).OfClass(typeof(ViewSheet)).Cast<ViewSheet>().Count(sheet => !sheet.IsTemplate),
        new FilteredElementCollector(document).OfClass(typeof(ViewSchedule)).Cast<ViewSchedule>().Count(schedule => !schedule.IsTemplate),
        new FilteredElementCollector(document).OfClass(typeof(Family)).Count()
    );

    private static List<RevitAgentVisibleCategorySummary> CollectVisibleCategories(
        Document document,
        View activeView,
        int maxCategories,
        List<RevitDataIssue> issues,
        IReadOnlyCollection<string> requestedCategoryNames,
        int maxSampleElementsPerCategory
    ) {
        var visibleViews = new List<VisibleContextView> {
            new(
                activeView,
                [new RevitAgentContextProvenance(RevitAgentContextProvenanceKind.ActiveView, "Current active Revit view.")]
            )
        };
        var categoryFilter = CreateVisibleCategoryCollectorFilter(document, requestedCategoryNames);
        var visibleEntries = CollectVisibleEntries(document, visibleViews, categoryFilter, issues);
        return CreateVisibleCategories(
            document,
            visibleEntries,
            visibleViews,
            maxCategories,
            issues,
            requestedCategoryNames,
            maxSampleElementsPerCategory,
            false
        );
    }

    private static List<VisibleContextView> ResolveVisibleContextViews(
        Document document,
        View? activeView,
        RevitAgentVisibleContextRequest request,
        int maxViews,
        List<RevitDataIssue> issues
    ) {
        if (request.Scope == RevitAgentVisibleContextScope.ActiveViewVisible) {
            if (activeView != null) {
                return [new VisibleContextView(
                    activeView,
                    [new RevitAgentContextProvenance(RevitAgentContextProvenanceKind.ActiveView, "Current active Revit view.")]
                )];
            }

            issues.Add(new RevitDataIssue(
                "AgentContextNoActiveView",
                RevitDataIssueSeverity.Warning,
                "No active view is available.",
                TypeName: nameof(View)
            ));
            return [];
        }

        var visibleViews = new List<VisibleContextView>();
        var seenViewIds = new HashSet<long>();
        var viewIds = (request.ViewIds ?? [])
            .Distinct()
            .ToList();
        var viewUniqueIds = (request.ViewUniqueIds ?? [])
            .Where(value => !string.IsNullOrWhiteSpace(value))
            .Select(value => value.Trim())
            .Distinct(StringComparer.Ordinal)
            .ToList();

        foreach (var viewId in viewIds)
            AddResolvedVisibleView(document, document.GetElement(viewId.ToElementId()), $"view id {viewId}", visibleViews, seenViewIds, issues);

        foreach (var uniqueId in viewUniqueIds)
            AddResolvedVisibleView(document, document.GetElement(uniqueId), $"view unique id '{uniqueId}'", visibleViews, seenViewIds, issues);

        if (visibleViews.Count == 0) {
            issues.Add(new RevitDataIssue(
                "AgentContextViewReferencesRequired",
                RevitDataIssueSeverity.Warning,
                "ViewReferences scope requires at least one resolvable view id or unique id.",
                TypeName: nameof(RevitAgentVisibleContextRequest)
            ));
            return [];
        }

        if (visibleViews.Count > maxViews) {
            issues.Add(new RevitDataIssue(
                "AgentContextVisibleViewsTruncated",
                RevitDataIssueSeverity.Warning,
                $"Visible context matched {visibleViews.Count} views; returning the first {maxViews}.",
                TypeName: nameof(View)
            ));
        }

        return visibleViews.Take(maxViews).ToList();
    }

    private static void AddResolvedVisibleView(
        Document document,
        Element? element,
        string referenceLabel,
        List<VisibleContextView> visibleViews,
        HashSet<long> seenViewIds,
        List<RevitDataIssue> issues
    ) {
        if (element is ViewSheet sheet) {
            foreach (var placedView in sheet.GetAllPlacedViews()
                         .Select(document.GetElement)
                         .OfType<View>()
                         .Where(view => !view.IsTemplate)) {
                if (seenViewIds.Add(placedView.Id.Value())) {
                    visibleViews.Add(new VisibleContextView(
                        placedView,
                        [new RevitAgentContextProvenance(RevitAgentContextProvenanceKind.SheetPlacement, $"View is placed on sheet '{sheet.SheetNumber} - {sheet.Name}' from {referenceLabel}.")]
                    ));
                }
            }
            return;
        }

        if (element is not View view) {
            issues.Add(new RevitDataIssue(
                "AgentContextVisibleViewReferenceNotFound",
                RevitDataIssueSeverity.Warning,
                $"Could not resolve {referenceLabel} to a Revit view.",
                TypeName: nameof(View)
            ));
            return;
        }

        if (view.IsTemplate) {
            issues.Add(new RevitDataIssue(
                "AgentContextVisibleViewReferenceTemplate",
                RevitDataIssueSeverity.Warning,
                $"Resolved {referenceLabel} to template view '{view.Title}', which cannot be used for visible element collection.",
                TypeName: nameof(View)
            ));
            return;
        }

        if (seenViewIds.Add(view.Id.Value())) {
            visibleViews.Add(new VisibleContextView(
                view,
                [new RevitAgentContextProvenance(RevitAgentContextProvenanceKind.ExplicitReference, $"View came from explicit reference {referenceLabel}.")]
            ));
        }
    }

    private static List<VisibleElementEntry> CollectVisibleEntries(
        Document document,
        IReadOnlyList<VisibleContextView> visibleViews,
        VisibleCategoryCollectorFilter categoryFilter,
        List<RevitDataIssue> issues
    ) {
        LogVisibleCategoryCollectorFilter(categoryFilter, visibleViews.Count);
        if (categoryFilter.RequestedNames.Count != 0 && categoryFilter.CategoryIds.Count == 0)
            return [];

        var entries = new List<VisibleElementEntry>();
        foreach (var visibleView in visibleViews) {
            try {
                var collector = new FilteredElementCollector(document, visibleView.View.Id)
                    .WhereElementIsNotElementType();
                if (categoryFilter.CategoryIds.Count != 0)
                    collector = collector.WherePasses(new ElementMulticategoryFilter(categoryFilter.CategoryIds));

                entries.AddRange(collector
                    .Where(element => element.Category != null)
                    .Select(element => new VisibleElementEntry(element, visibleView)));
            } catch (Exception ex) {
                issues.Add(new RevitDataIssue(
                    "AgentContextVisibleCollectFailed",
                    RevitDataIssueSeverity.Warning,
                    $"Failed to collect visible elements from view '{visibleView.View.Title}': {ex.Message}",
                    TypeName: visibleView.View.GetType().Name
                ));
            }
        }

        return entries;
    }

    private static VisibleCategoryCollectorFilter CreateVisibleCategoryCollectorFilter(
        Document document,
        IReadOnlyCollection<string> requestedCategoryNames
    ) {
        var requestedNames = requestedCategoryNames
            .Select(name => name.Trim())
            .Where(name => !string.IsNullOrWhiteSpace(name))
            .ToHashSet(IgnoreCase);
        var documentCategories = document.Settings.Categories
            .Cast<Category>()
            .Where(category => category.Id != ElementId.InvalidElementId)
            .ToList();
        var categoryIds = requestedNames.Count == 0
            ? []
            : documentCategories
                .Where(category => requestedNames.Contains(category.Name))
                .Select(category => category.Id)
                .GroupBy(id => id.Value())
                .Select(group => group.First())
                .ToList();

        return new VisibleCategoryCollectorFilter(requestedNames, categoryIds, documentCategories.Count);
    }

    private static void LogVisibleCategoryCollectorFilter(
        VisibleCategoryCollectorFilter categoryFilter,
        int viewCollectorCount
    ) {
        if (categoryFilter.RequestedNames.Count == 0)
            return;

        var excludedDocumentCategoryCount = Math.Max(0, categoryFilter.DocumentCategoryCount - categoryFilter.CategoryIds.Count);
        Log.Information(
            "VisibleSummary category prefilter applied: RequestedCategories={RequestedCategories}, ResolvedCategories={ResolvedCategories}, UnresolvedCategories={UnresolvedCategories}, DocumentCategories={DocumentCategories}, ExcludedDocumentCategories={ExcludedDocumentCategories}, FilteredViewCollectors={FilteredViewCollectors}, AvoidedUnfilteredViewCollectors={AvoidedUnfilteredViewCollectors}",
            categoryFilter.RequestedNames.Count,
            categoryFilter.CategoryIds.Count,
            Math.Max(0, categoryFilter.RequestedNames.Count - categoryFilter.CategoryIds.Count),
            categoryFilter.DocumentCategoryCount,
            excludedDocumentCategoryCount,
            viewCollectorCount,
            categoryFilter.CategoryIds.Count == 0 ? 0 : viewCollectorCount
        );
    }

    private static List<RevitAgentVisibleCategorySummary> CreateVisibleCategories(
        Document document,
        IReadOnlyList<VisibleElementEntry> visibleEntries,
        IReadOnlyList<VisibleContextView> visibleViews,
        int maxCategories,
        List<RevitDataIssue> issues,
        IReadOnlyCollection<string> requestedCategoryNames,
        int maxReturnedElementsPerCategory,
        bool returnElementHandlesOnly
    ) {
        var requestedCategories = requestedCategoryNames
            .Select(name => name.Trim())
            .Where(name => !string.IsNullOrWhiteSpace(name))
            .ToHashSet(IgnoreCase);
        var groupedElements = visibleEntries
            .Where(entry => entry.Element.Category != null)
            .GroupBy(entry => entry.Element.Category!.Name, IgnoreCase)
            .Where(group => requestedCategories.Count == 0 || requestedCategories.Contains(group.Key))
            .ToList();

        foreach (var missingCategory in requestedCategories.Except(groupedElements.Select(group => group.Key), IgnoreCase)) {
            issues.Add(new RevitDataIssue(
                "AgentContextVisibleCategoryNotFound",
                RevitDataIssueSeverity.Warning,
                $"No visible elements in requested view scope matched category '{missingCategory}'.",
                TypeName: nameof(Category),
                ParameterName: missingCategory
            ));
        }

        var provenanceKind = visibleViews.Any(view => view.Provenance.Any(item => item.Kind == RevitAgentContextProvenanceKind.ActiveView))
            ? RevitAgentContextProvenanceKind.VisibleInActiveView
            : RevitAgentContextProvenanceKind.VisibleInReferencedView;
        var provenanceDescription = visibleViews.Count == 1
            ? $"Category has visible elements in view '{visibleViews[0].View.Title}'."
            : $"Category has visible elements across {visibleViews.Count} referenced views.";

        return groupedElements
            .Select(group => {
                var elementGroups = group
                    .GroupBy(entry => entry.Element.Id.Value())
                    .Select(elementGroup => elementGroup.ToList())
                    .OrderBy(elementGroup => returnElementHandlesOnly
                        ? elementGroup[0].Element.Id.Value().ToString()
                        : CreateElementLabel(elementGroup[0].Element, elementGroup[0].Element as FamilyInstance), IgnoreCase)
                    .ToList();
                var returnedElementGroups = elementGroups
                    .Take(maxReturnedElementsPerCategory)
                    .ToList();
                var returnedElements = returnElementHandlesOnly
                    ? new List<RevitAgentVisibleElementSample>()
                    : returnedElementGroups
                        .Select(elementGroup => CreateVisibleElementSample(
                            document,
                            elementGroup[0].Element,
                            elementGroup.Select(entry => entry.VisibleView).ToList()
                        ))
                        .ToList();
                var returnedHandles = returnElementHandlesOnly
                    ? returnedElementGroups
                        .Select(elementGroup => CreateVisibleElementHandle(
                            document,
                            elementGroup[0].Element,
                            elementGroup.Select(entry => entry.VisibleView).ToList()
                        ))
                        .ToList()
                    : null;

                return new RevitAgentVisibleCategorySummary(
                    new RevitAgentContextHandle(
                        RevitAgentContextHandleKind.Category,
                        document.GetDocumentKey(),
                        null,
                        null,
                        group.Key,
                        group.Key
                    ),
                    elementGroups.Count,
                    returnedElements,
                    [new RevitAgentContextProvenance(provenanceKind, provenanceDescription)],
                    returnElementHandlesOnly ? returnedHandles?.Count ?? 0 : returnedElements.Count,
                    (returnElementHandlesOnly ? returnedHandles?.Count ?? 0 : returnedElements.Count) == elementGroups.Count,
                    returnedHandles
                );
            })
            .OrderByDescending(category => category.ElementCount)
            .ThenBy(category => category.Handle.Label, IgnoreCase)
            .Take(maxCategories)
            .ToList();
    }

    private static List<RevitAgentVisibleViewSummary> CreateVisibleViewSummaries(
        Document document,
        IReadOnlyList<VisibleContextView> visibleViews,
        IReadOnlyList<VisibleElementEntry> visibleEntries
    ) => visibleViews
        .Select(visibleView => new RevitAgentVisibleViewSummary(
            CreateHandle(document, visibleView.View, RevitAgentContextHandleKind.View, visibleView.View.Title),
            visibleView.View.ViewType.ToString(),
            visibleView.View.Title,
            visibleEntries
                .Where(entry => entry.VisibleView.View.Id.Value() == visibleView.View.Id.Value())
                .Select(entry => entry.Element.Id.Value())
                .Distinct()
                .Count(),
            visibleView.Provenance
        ))
        .OrderBy(summary => summary.Title, IgnoreCase)
        .ToList();

    private static IEnumerable<RevitAgentContextCandidate> CreateActiveViewCandidates(
        Document document,
        View activeView,
        IReadOnlyList<string> tokens
    ) {
        var viewContext = CreateActiveViewContext(document, activeView, CreateSheetPlacementIndex(document));
        var activeScore = tokens.Any(token => token is "this" or "active" or "current") ? 3 : 0;
        var viewScore = tokens.Any(token => token is "view" or "plan" or "sheet" or "schedule") ? 3 : 0;
        var labelScore = ScoreText(viewContext.Title, tokens);
        var score = activeScore + viewScore + labelScore;
        if (score > 0) {
            yield return new RevitAgentContextCandidate(
                viewContext.Handle,
                viewContext.Title,
                score,
                viewContext.Provenance,
                viewContext.SheetPlacements.Select(placement => placement.Sheet).ToList()
            );
        }

        foreach (var placement in viewContext.SheetPlacements) {
            var sheetScore = ScoreText($"{placement.SheetNumber} {placement.SheetName} {viewContext.Title}", tokens);
            if (sheetScore <= 0)
                continue;

            yield return new RevitAgentContextCandidate(
                placement.Sheet,
                $"{placement.SheetNumber} - {placement.SheetName}",
                sheetScore + 2,
                [new RevitAgentContextProvenance(RevitAgentContextProvenanceKind.SheetPlacement, $"Active view is placed on sheet {placement.SheetNumber}.")],
                [viewContext.Handle]
            );
        }
    }

    private static IEnumerable<RevitAgentContextCandidate> CreateSelectionCandidates(
        Document document,
        IReadOnlyCollection<ElementId>? currentSelection,
        IReadOnlyList<string> tokens
    ) {
        var entries = CreateSelectionContext(document, currentSelection, 50).Entries;
        var selectionIntent = tokens.Any(token => token is "selected" or "selection" or "equipment") ? 4 : 0;
        foreach (var entry in entries) {
            var score = selectionIntent + ScoreText($"{entry.Handle.Label} {entry.Handle.CategoryName} {entry.FamilyName} {entry.TypeName} {entry.Mark} {entry.LevelName}", tokens);
            if (score <= 0)
                continue;

            yield return new RevitAgentContextCandidate(
                entry.Handle,
                entry.Handle.Label,
                score,
                entry.Provenance,
                []
            );
        }
    }

    private static IEnumerable<RevitAgentContextCandidate> CreateBrowserCandidates(
        Document document,
        IReadOnlyList<string> tokens,
        IReadOnlyCollection<RevitAgentContextHandleKind> allowedKinds,
        bool requirePrintedContext
    ) {
        var placementIndex = TimePhase("browser-placement-index", () => CreateSheetPlacementIndex(document));
        var filterByKind = allowedKinds.Count != 0;
        if (!filterByKind || allowedKinds.Contains(RevitAgentContextHandleKind.View)) foreach (var view in new FilteredElementCollector(document).OfClass(typeof(View)).Cast<View>().Where(view => !view.IsTemplate)) {
            var placements = FindSheetPlacements(document, view, placementIndex);
            if (requirePrintedContext && placements.Count == 0)
                continue;
            var text = $"{view.Title} {view.ViewType} {view.GenLevel?.Name} {TryRead(() => view.Discipline.ToString())} {string.Join(" ", placements.Select(placement => $"{placement.SheetNumber} {placement.SheetName}"))}";
            var score = ScoreText(text, tokens) + (placements.Count > 0 && tokens.Any(token => token is "printed" or "print" or "sheet") ? 2 : 0);
            if (score > 0) {
                yield return new RevitAgentContextCandidate(
                    CreateHandle(document, view, RevitAgentContextHandleKind.View, view.Title),
                    view.Title,
                    score,
                    [new RevitAgentContextProvenance(placements.Count > 0 ? RevitAgentContextProvenanceKind.PrintedContext : RevitAgentContextProvenanceKind.BrowserIndex, placements.Count > 0 ? "View is placed on a sheet and can participate in printed context." : "View matched the project browser view index.")],
                    placements.Select(placement => placement.Sheet).ToList()
                );
            }
        }

        foreach (var sheet in new FilteredElementCollector(document).OfClass(typeof(ViewSheet)).Cast<ViewSheet>().Where(sheet => !sheet.IsTemplate)) {
            var score = ScoreText($"{sheet.SheetNumber} {sheet.Name}", tokens) + (tokens.Any(token => token is "sheet" or "printed" or "print") ? 1 : 0);
            if (score > 0) {
                yield return new RevitAgentContextCandidate(
                    CreateHandle(document, sheet, RevitAgentContextHandleKind.Sheet, $"{sheet.SheetNumber} - {sheet.Name}"),
                    $"{sheet.SheetNumber} - {sheet.Name}",
                    score,
                    [new RevitAgentContextProvenance(RevitAgentContextProvenanceKind.PrintedContext, "Sheet matched printed/browser context.")],
                    GetPlacedViewHandles(document, sheet, placementIndex)
                );
            }
        }

        if (!requirePrintedContext && (!filterByKind || allowedKinds.Contains(RevitAgentContextHandleKind.Family))) foreach (var family in new FilteredElementCollector(document).OfClass(typeof(Family)).Cast<Family>()) {
            var score = ScoreText(family.Name, tokens) + (tokens.Contains("family") ? 1 : 0);
            if (score > 0) {
                yield return new RevitAgentContextCandidate(
                    CreateHandle(document, family, RevitAgentContextHandleKind.Family, family.Name),
                    family.Name,
                    score,
                    [new RevitAgentContextProvenance(RevitAgentContextProvenanceKind.BrowserIndex, "Family matched the project browser family index.")],
                    []
                );
            }
        }
    }


    private static bool IsPrintedContextCandidate(RevitAgentContextCandidate candidate) =>
        candidate.Provenance.Any(provenance => provenance.Kind is RevitAgentContextProvenanceKind.PrintedContext or RevitAgentContextProvenanceKind.SheetPlacement)
        || candidate.RelatedHandles.Any(handle => handle.Kind == RevitAgentContextHandleKind.Sheet);

    private static RevitAgentContextCandidate CompactCandidate(RevitAgentContextCandidate candidate) => new(
        candidate.Handle,
        candidate.Label,
        candidate.Score,
        candidate.Provenance.Take(1).ToList(),
        candidate.RelatedHandles
            .Where(handle => handle.Kind is RevitAgentContextHandleKind.View or RevitAgentContextHandleKind.Sheet)
            .Take(4)
            .ToList()
    );

    private static List<RevitAgentViewSheetPlacement> FindSheetPlacements(Document document, View view, SheetPlacementIndex placementIndex) {
        if (view is ViewSheet activeSheet)
            return [CreateSheetPlacement(document, activeSheet, true)];

        var placements = placementIndex.SheetPlacementsByViewId.TryGetValue(view.Id.Value(), out var sheetPlacements)
            ? sheetPlacements
            : [];

        return placements
            .GroupBy(placement => placement.Sheet.ElementId)
            .Select(group => group.First())
            .OrderBy(placement => placement.SheetNumber, IgnoreCase)
            .ThenBy(placement => placement.SheetName, IgnoreCase)
            .ToList();
    }

    private static RevitAgentViewSheetPlacement CreateSheetPlacement(Document document, ViewSheet sheet, bool isActiveSheet) => new(
        CreateHandle(document, sheet, RevitAgentContextHandleKind.Sheet, $"{sheet.SheetNumber} - {sheet.Name}"),
        sheet.SheetNumber,
        sheet.Name,
        isActiveSheet
    );

    private static List<RevitAgentContextHandle> GetPlacedViewHandles(Document document, ViewSheet sheet, SheetPlacementIndex placementIndex) =>
        placementIndex.PlacedViewHandlesBySheetId.TryGetValue(sheet.Id.Value(), out var handles) ? handles : [];

    private static SheetPlacementIndex CreateSheetPlacementIndex(Document document) {
        var sheetPlacementsByViewId = new Dictionary<long, List<RevitAgentViewSheetPlacement>>();
        var placedViewHandlesBySheetId = new Dictionary<long, List<RevitAgentContextHandle>>();

        foreach (var sheet in new FilteredElementCollector(document).OfClass(typeof(ViewSheet)).Cast<ViewSheet>().Where(sheet => !sheet.IsTemplate)) {
            foreach (var viewport in sheet.GetAllViewports().Select(document.GetElement).OfType<Viewport>()) {
                if (document.GetElement(viewport.ViewId) is not View placedView)
                    continue;
                Add(sheetPlacementsByViewId, placedView.Id.Value(), CreateSheetPlacement(document, sheet, false));
                Add(placedViewHandlesBySheetId, sheet.Id.Value(), CreateHandle(document, placedView, RevitAgentContextHandleKind.View, placedView.Title));
            }
        }

        foreach (var instance in new FilteredElementCollector(document).OfClass(typeof(ScheduleSheetInstance)).Cast<ScheduleSheetInstance>()) {
            if (document.GetElement(instance.OwnerViewId) is not ViewSheet sheet || document.GetElement(instance.ScheduleId) is not ViewSchedule schedule)
                continue;
            Add(sheetPlacementsByViewId, schedule.Id.Value(), CreateSheetPlacement(document, sheet, false));
        }

        return new SheetPlacementIndex(sheetPlacementsByViewId, placedViewHandlesBySheetId);
    }

    private static void Add<T>(Dictionary<long, List<T>> dictionary, long key, T value) {
        if (!dictionary.TryGetValue(key, out var values)) {
            values = [];
            dictionary[key] = values;
        }

        values.Add(value);
    }

    private sealed record SheetPlacementIndex(
        IReadOnlyDictionary<long, List<RevitAgentViewSheetPlacement>> SheetPlacementsByViewId,
        IReadOnlyDictionary<long, List<RevitAgentContextHandle>> PlacedViewHandlesBySheetId
    );

    private static RevitAgentContextHandle CreateHandle(
        Document document,
        Element element,
        RevitAgentContextHandleKind kind,
        string label
    ) => new(
        kind,
        document.GetDocumentKey(),
        element.Id.Value(),
        element.UniqueId,
        label,
        element.Category?.Name
    );

    private static string CreateElementLabel(Element element, FamilyInstance? family) {
        var parts = new[] {
                family?.Symbol?.Family?.Name,
                family?.Symbol?.Name,
                ReadMark(element),
                element.Name
            }
            .Where(part => !string.IsNullOrWhiteSpace(part))
            .Distinct(IgnoreCase)
            .ToList();
        return parts.Count == 0 ? $"{element.GetType().Name} {element.Id.Value()}" : string.Join(" / ", parts);
    }

    private static string? GetLevelName(Document document, Element element) {
        if (element.LevelId != ElementId.InvalidElementId && document.GetElement(element.LevelId) is Level level)
            return level.Name;
        return null;
    }

    private static string? ReadMark(Element element) => TryRead(() => element.LookupParameter("Mark")?.AsString());

    private static string? TryReadViewTemplateName(Document document, View view) => TryRead(() =>
        view.ViewTemplateId != ElementId.InvalidElementId && document.GetElement(view.ViewTemplateId) is View template
            ? template.Name
            : null
    );

    private static string? TryReadPhaseName(Document document, View view) => TryRead(() => {
        var parameter = view.get_Parameter(BuiltInParameter.VIEW_PHASE);
        if (parameter == null || parameter.AsElementId() == ElementId.InvalidElementId)
            return null;
        return document.GetElement(parameter.AsElementId())?.Name;
    });

    private static T? TryRead<T>(Func<T?> read) {
        try {
            return read();
        } catch {
            return default;
        }
    }

    private static T TimePhase<T>(string phase, Func<T> action) {
        var stopwatch = Stopwatch.StartNew();
        var result = action();
        Log.Debug("RevitAgentContext {Phase} collected in {ElapsedMilliseconds} ms", phase, stopwatch.ElapsedMilliseconds);
        return result;
    }

    private static int ScoreText(string? text, IReadOnlyList<string> tokens) {
        if (string.IsNullOrWhiteSpace(text))
            return 0;

        var normalized = text.ToLowerInvariant();
        return tokens.Count(token => normalized.Contains(token, StringComparison.OrdinalIgnoreCase));
    }

    private static int Clamp(int value, int min, int max) => Math.Min(Math.Max(value, min), max);

    private static int BoundRequestedCount(
        int requested,
        int min,
        int max,
        string propertyName,
        List<RevitDataIssue> issues
    ) {
        var bounded = Clamp(requested, min, max);
        if (bounded != requested) {
            issues.Add(new RevitDataIssue(
                "AgentContextRequestLimitAdjusted",
                RevitDataIssueSeverity.Warning,
                $"{propertyName} must be between {min} and {max}; using {bounded}.",
                TypeName: nameof(RevitAgentVisibleContextRequest),
                ParameterName: propertyName
            ));
        }

        return bounded;
    }

    private static IReadOnlyList<string> Tokenize(string value) => value
        .ToLowerInvariant()
        .Split(value.Select(character => char.IsLetterOrDigit(character) ? ' ' : character).Distinct().Where(character => !char.IsLetterOrDigit(character)).ToArray(), StringSplitOptions.RemoveEmptyEntries)
        .Select(token => token.Trim())
        .Where(token => token.Length > 1)
        .Where(token => token is not "the" and not "this" and not "that" and not "with" and not "from")
        .ToList();
}
