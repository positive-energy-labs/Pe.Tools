using Pe.Shared.RevitData;

namespace Pe.Revit.DocumentData.AgentContext;

public static class RevitAgentContextCollector {
    private static readonly StringComparer IgnoreCase = StringComparer.OrdinalIgnoreCase;

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
        if (activeView == null) {
            issues.Add(new RevitDataIssue(
                "AgentContextNoActiveView",
                RevitDataIssueSeverity.Warning,
                "No active view is available.",
                TypeName: nameof(View)
            ));
            return new RevitAgentVisibleContextData(null, 0, [], issues);
        }

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
        var categories = CollectVisibleCategories(
            document,
            activeView,
            maxCategories,
            issues,
            request.CategoryNames ?? [],
            maxSampleElements
        );
        return new RevitAgentVisibleContextData(
            CreateHandle(document, activeView, RevitAgentContextHandleKind.View, activeView.Title),
            categories.Sum(category => category.ElementCount),
            categories,
            issues
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

        var candidates = new List<RevitAgentContextCandidate>();
        if (activeView != null)
            candidates.AddRange(CreateActiveViewCandidates(document, activeView, tokens));

        candidates.AddRange(CreateSelectionCandidates(document, currentSelection, tokens));
        candidates.AddRange(CreateBrowserCandidates(document, tokens));

        var maxResults = Math.Clamp(request.MaxResults, 1, 50);
        var results = candidates
            .Where(candidate => candidate.Score > 0)
            .GroupBy(candidate => $"{candidate.Handle.Kind}:{candidate.Handle.DocumentKey}:{candidate.Handle.ElementId}:{candidate.Handle.UniqueId}")
            .Select(group => group.OrderByDescending(candidate => candidate.Score).First())
            .OrderByDescending(candidate => candidate.Score)
            .ThenBy(candidate => candidate.Label, IgnoreCase)
            .Take(maxResults)
            .ToList();

        if (results.Count == 0) {
            issues.Add(new RevitDataIssue(
                "AgentContextNoCandidates",
                RevitDataIssueSeverity.Info,
                $"No Revit context candidates matched '{referenceText}'.",
                TypeName: nameof(RevitAgentContextCandidate)
            ));
        }

        return new RevitAgentContextResolveData(referenceText, results.Count, results, issues);
    }

    private static RevitAgentActiveViewContext CreateActiveViewContext(Document document, View view) => new(
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
        FindSheetPlacements(document, view).Take(8).ToList(),
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

    private static RevitAgentVisibleElementSample CreateVisibleElementSample(Document document, Element element) {
        var family = element as FamilyInstance;
        return new RevitAgentVisibleElementSample(
            CreateHandle(document, element, RevitAgentContextHandleKind.Element, CreateElementLabel(element, family)),
            element.GetType().Name,
            family?.Symbol?.Family?.Name,
            family?.Symbol?.Name,
            GetLevelName(document, element)
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
        try {
            var requestedCategories = requestedCategoryNames
                .Select(name => name.Trim())
                .Where(name => !string.IsNullOrWhiteSpace(name))
                .ToHashSet(IgnoreCase);
            var groupedElements = new FilteredElementCollector(document, activeView.Id)
                .WhereElementIsNotElementType()
                .Where(element => element.Category != null)
                .GroupBy(element => element.Category!.Name, IgnoreCase)
                .Where(group => requestedCategories.Count == 0 || requestedCategories.Contains(group.Key))
                .ToList();

            foreach (var missingCategory in requestedCategories.Except(groupedElements.Select(group => group.Key), IgnoreCase)) {
                issues.Add(new RevitDataIssue(
                    "AgentContextVisibleCategoryNotFound",
                    RevitDataIssueSeverity.Warning,
                    $"No visible elements in active view '{activeView.Title}' matched requested category '{missingCategory}'.",
                    TypeName: nameof(Category),
                    ParameterName: missingCategory
                ));
            }

            return groupedElements
                .Select(group => new RevitAgentVisibleCategorySummary(
                    new RevitAgentContextHandle(
                        RevitAgentContextHandleKind.Category,
                        document.GetDocumentKey(),
                        null,
                        null,
                        group.Key,
                        group.Key
                    ),
                    group.Count(),
                    group
                        .Take(maxSampleElementsPerCategory)
                        .Select(element => CreateVisibleElementSample(document, element))
                        .ToList(),
                    [new RevitAgentContextProvenance(RevitAgentContextProvenanceKind.VisibleInActiveView, $"Category has visible elements in active view '{activeView.Title}'.")]
                ))
                .OrderByDescending(category => category.ElementCount)
                .ThenBy(category => category.Handle.Label, IgnoreCase)
                .Take(maxCategories)
                .ToList();
        } catch (Exception ex) {
            issues.Add(new RevitDataIssue(
                "AgentContextVisibleCollectFailed",
                RevitDataIssueSeverity.Warning,
                ex.Message,
                TypeName: activeView.GetType().Name
            ));
            return [];
        }
    }

    private static IEnumerable<RevitAgentContextCandidate> CreateActiveViewCandidates(
        Document document,
        View activeView,
        IReadOnlyList<string> tokens
    ) {
        var viewContext = CreateActiveViewContext(document, activeView);
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
        IReadOnlyList<string> tokens
    ) {
        foreach (var view in new FilteredElementCollector(document).OfClass(typeof(View)).Cast<View>().Where(view => !view.IsTemplate)) {
            var placements = FindSheetPlacements(document, view).ToList();
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
                    GetPlacedViewHandles(document, sheet)
                );
            }
        }

        foreach (var family in new FilteredElementCollector(document).OfClass(typeof(Family)).Cast<Family>()) {
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

    private static List<RevitAgentViewSheetPlacement> FindSheetPlacements(Document document, View view) {
        if (view is ViewSheet activeSheet)
            return [CreateSheetPlacement(document, activeSheet, true)];

        var placements = new List<RevitAgentViewSheetPlacement>();
        foreach (var candidateSheet in new FilteredElementCollector(document).OfClass(typeof(ViewSheet)).Cast<ViewSheet>()) {
            var containsViewport = candidateSheet.GetAllViewports()
                .Select(document.GetElement)
                .OfType<Viewport>()
                .Any(viewport => viewport.ViewId == view.Id);
            if (containsViewport)
                placements.Add(CreateSheetPlacement(document, candidateSheet, false));
        }

        if (view is ViewSchedule) {
            var schedulePlacements = new FilteredElementCollector(document)
                .OfClass(typeof(ScheduleSheetInstance))
                .Cast<ScheduleSheetInstance>()
                .Where(instance => instance.ScheduleId == view.Id)
                .Select(instance => document.GetElement(instance.OwnerViewId))
                .OfType<ViewSheet>()
                .Select(sheet => CreateSheetPlacement(document, sheet, false));
            placements.AddRange(schedulePlacements);
        }

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

    private static List<RevitAgentContextHandle> GetPlacedViewHandles(Document document, ViewSheet sheet) => sheet.GetAllViewports()
        .Select(document.GetElement)
        .OfType<Viewport>()
        .Select(viewport => document.GetElement(viewport.ViewId))
        .OfType<View>()
        .Select(view => CreateHandle(document, view, RevitAgentContextHandleKind.View, view.Title))
        .ToList();

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

    private static int ScoreText(string? text, IReadOnlyList<string> tokens) {
        if (string.IsNullOrWhiteSpace(text))
            return 0;

        var normalized = text.ToLowerInvariant();
        return tokens.Count(token => normalized.Contains(token, StringComparison.OrdinalIgnoreCase));
    }

    private static int BoundRequestedCount(
        int requested,
        int min,
        int max,
        string propertyName,
        List<RevitDataIssue> issues
    ) {
        var bounded = Math.Clamp(requested, min, max);
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
