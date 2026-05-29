using Pe.Revit.DocumentData.ProjectBrowser;
using Pe.Revit.DocumentData.Schedules.Apply;
using Pe.Shared.RevitData;
using Pe.Shared.RevitData.Schedules;

namespace Pe.Revit.DocumentData.Schedules.Collect;

public static class ScheduleCatalogCollector {
    public static ScheduleCatalogData Collect(
        Document doc,
        ScheduleCatalogRequest? request = null
    ) {
        var categoryNames = ScheduleCollectorSupport.ToFilterSet(request?.CategoryNames);
        var scheduleNames = ScheduleCollectorSupport.ToFilterSet(request?.ScheduleNames);
        var customParameterFilters = request?.CustomParameterFilters ?? [];
        var includeTemplates = request?.IncludeTemplates ?? false;
        var projection = request?.Projection ?? new ScheduleCatalogProjection();
        var budget = RevitDataOutputBudgets.WithDefaults(request?.Budget, maxEntries: 25);
        var maxEntries = budget.MaxEntries;
        var issues = new List<RevitDataIssue>();
        var shouldCollectBrowserIndex = request?.BrowserFilter != null || projection.View is RevitDataResultView.Handles or RevitDataResultView.Rows or RevitDataResultView.Full;
        var browserIndex = shouldCollectBrowserIndex
            ? ProjectBrowserCollector.CollectIndex(
                doc,
                new HashSet<ProjectBrowserSection> { ProjectBrowserSection.Schedules },
                Math.Max(0, budget.MaxSamplesPerEntry ?? 5),
                ProjectBrowserResultView.Items,
                request?.BrowserFilter == null ? null : request.BrowserFilter with { Section = ProjectBrowserSection.Schedules },
                issues
            )
            : ProjectBrowserCollectedIndex.Empty;

        var allEntries = new FilteredElementCollector(doc)
            .OfClass(typeof(ViewSchedule))
            .Cast<ViewSchedule>()
            .Where(schedule => includeTemplates || !schedule.IsTemplate)
            .Where(schedule => !schedule.Name.Contains("<Revision Schedule>", StringComparison.OrdinalIgnoreCase))
            .Where(schedule => MatchesPreProjectionFilter(schedule, categoryNames, scheduleNames, customParameterFilters, request))
            .OrderBy(schedule => schedule.Name, StringComparer.OrdinalIgnoreCase)
            .Select(schedule => TryCollectEntry(doc, schedule, projection, issues))
            .Where(entry => entry != null)
            .Cast<ScheduleCatalogEntry>()
            .Select(entry => AttachBrowserPaths(entry, browserIndex, request))
            .Where(entry => MatchesBrowserFilter(entry, request))
            .Where(entry => MatchesPostProjectionFilter(entry, request))
            .ToList();

        var entries = maxEntries is > 0
            ? allEntries.Take(maxEntries.Value).ToList()
            : allEntries;
        var truncated = maxEntries is > 0 && allEntries.Count > entries.Count;
        if (truncated) {
            issues.Add(new RevitDataIssue(
                "ScheduleCatalogTruncated",
                RevitDataIssueSeverity.Warning,
                $"Returned {entries.Count} of {allEntries.Count} matching schedule(s). Increase budget.maxEntries to expand."
            ));
        }
        AddFilterOverlapWarnings(entries, issues);
        AddSheetFilterDiagnostics(doc, request, projection, browserIndex, allEntries, entries, issues);

        return new ScheduleCatalogData(
            entries,
            RevitDataOutputBudgets.ProjectIssues(issues, budget),
            new RevitDataResultPage(allEntries.Count, entries.Count, truncated)
        );
    }

    private static ScheduleCatalogEntry AttachBrowserPaths(ScheduleCatalogEntry entry, ProjectBrowserCollectedIndex browserIndex, ScheduleCatalogRequest? request) {
        var includeBrowserPaths = request?.BrowserFilter != null || request?.Projection?.View is RevitDataResultView.Handles or RevitDataResultView.Rows or RevitDataResultView.Full;
        var paths = browserIndex.Get(ProjectBrowserSection.Schedules, new ElementId(entry.ScheduleId), includeBrowserPaths);
        return entry with { BrowserPaths = paths };
    }

    private static bool MatchesBrowserFilter(ScheduleCatalogEntry entry, ScheduleCatalogRequest? request) => request?.BrowserFilter == null || entry.BrowserPaths.Count != 0;

    private static ScheduleCatalogEntry? TryCollectEntry(
        Document doc,
        ViewSchedule schedule,
        ScheduleCatalogProjection projection,
        List<RevitDataIssue> issues
    ) {
        try {
            var includeAll = projection.View == RevitDataResultView.Full;
            var profile = ScheduleHelper.SerializeSchedule(schedule);
            var sheetPlacements = ScheduleCollectorSupport.CollectSheetPlacements(doc, schedule);
            var visibleFamilyInstances = ScheduleVisibleFamilyCollector.CollectVisibleFamilyInstances(doc, schedule);
            var visibleFamilies = projection.IncludeVisibleFamilies || includeAll
                ? ScheduleVisibleFamilyCollector.CollectVisibleFamilies(visibleFamilyInstances)
                : [];
            var visibleBodyRowCount = ScheduleVisibleFamilyCollector.GetVisibleBodyRowCount(doc, schedule);
            var visibleInstanceCount = visibleFamilyInstances.Count;

            return new ScheduleCatalogEntry(
                schedule.Id.Value(),
                schedule.UniqueId,
                schedule.Name,
                ScheduleCollectorSupport.GetCategoryName(doc, schedule),
                schedule.IsTemplate,
                profile.ViewTemplateName,
                profile.IsItemized,
                profile.FilterBySheet,
                sheetPlacements.Count != 0,
                projection.IncludeSheetPlacements || includeAll ? sheetPlacements : [],
                projection.IncludeFilters || includeAll ? profile.Filters ?? [] : [],
                projection.IncludeParameterUsages || includeAll ? ScheduleCollectorSupport.CollectParameterUsages(doc, schedule) : [],
                projection.IncludeCustomParameters || includeAll ? ScheduleCollectorSupport.CollectCustomParameters(schedule) : [],
                visibleBodyRowCount,
                visibleFamilies.Count,
                visibleInstanceCount,
                visibleFamilies,
                []
            );
        } catch (Exception ex) {
            issues.Add(new RevitDataIssue(
                "ScheduleCatalogSerializationFailed",
                RevitDataIssueSeverity.Warning,
                ex.Message,
                TypeName: schedule.Name
            ));
            return null;
        }
    }


    private static void AddSheetFilterDiagnostics(
        Document doc,
        ScheduleCatalogRequest? request,
        ScheduleCatalogProjection projection,
        ProjectBrowserCollectedIndex browserIndex,
        IReadOnlyList<ScheduleCatalogEntry> allEntries,
        IReadOnlyList<ScheduleCatalogEntry> returnedEntries,
        List<RevitDataIssue> issues
    ) {
        if (request == null)
            return;

        var hasSheetFilter = !string.IsNullOrWhiteSpace(request.SheetNumberContains)
                             || !string.IsNullOrWhiteSpace(request.SheetNameContains)
                             || request.PlacementScope != SchedulePlacementScope.All;
        if (!hasSheetFilter)
            return;

        if (allEntries.Count == 0) {
            var sheetOnlyMatches = CollectSheetOnlyMatches(doc, request, projection, browserIndex, issues);
            if (sheetOnlyMatches.Count != 0) {
                var nameFilter = !string.IsNullOrWhiteSpace(request.ScheduleNameContains)
                    ? $"scheduleNameContains {request.ScheduleNameContains!.Trim()}"
                    : !string.IsNullOrWhiteSpace(request.ScheduleNamePrefix)
                        ? $"scheduleNamePrefix {request.ScheduleNamePrefix!.Trim()}"
                        : request.ScheduleNames.Count != 0
                            ? $"scheduleNames {string.Join(", ", request.ScheduleNames.Take(3))}"
                            : "non-sheet filters";
                var samples = string.Join(", ", sheetOnlyMatches.Select(entry => entry.Name).Distinct(StringComparer.OrdinalIgnoreCase).Take(5));
                issues.Add(new RevitDataIssue(
                    "ScheduleCatalogStagedFiltersReducedToZero",
                    RevitDataIssueSeverity.Warning,
                    $"Sheet filters matched {sheetOnlyMatches.Count} placed schedule(s), but {nameFilter} reduced that to 0. Nearby schedule names include {samples}."
                ));
                return;
            }

            issues.Add(new RevitDataIssue(
                "ScheduleCatalogSheetFilterMatchedZeroSchedules",
                RevitDataIssueSeverity.Warning,
                "Sheet placement filters matched zero schedules. Check sheetNumberContains/sheetNameContains or run revit.catalog.schedules with placementScope=PlacedOnly and a small budget."
            ));
            return;
        }

        if (returnedEntries.Count != 0 && returnedEntries.All(entry => !entry.IsPlacedOnSheet)) {
            issues.Add(new RevitDataIssue(
                "ScheduleCatalogNoSheetPlacementFactsReturned",
                RevitDataIssueSeverity.Warning,
                "Sheet filters were supplied but returned schedules do not include sheet-placement facts. Set projection.includeSheetPlacements=true when diagnosing printed context."
            ));
        }
    }

    private static List<ScheduleCatalogEntry> CollectSheetOnlyMatches(
        Document doc,
        ScheduleCatalogRequest request,
        ScheduleCatalogProjection projection,
        ProjectBrowserCollectedIndex browserIndex,
        List<RevitDataIssue> issues
    ) {
        var diagnosticIssues = new List<RevitDataIssue>();
        return new FilteredElementCollector(doc)
            .OfClass(typeof(ViewSchedule))
            .Cast<ViewSchedule>()
            .Where(schedule => request.IncludeTemplates || !schedule.IsTemplate)
            .Where(schedule => !schedule.Name.Contains("<Revision Schedule>", StringComparison.OrdinalIgnoreCase))
            .OrderBy(schedule => schedule.Name, StringComparer.OrdinalIgnoreCase)
            .Select(schedule => TryCollectEntry(doc, schedule, projection, diagnosticIssues))
            .Where(entry => entry != null)
            .Cast<ScheduleCatalogEntry>()
            .Select(entry => AttachBrowserPaths(entry, browserIndex, request))
            .Where(entry => MatchesSheetOnlyFilter(entry, request))
            .Take(25)
            .ToList();
    }

    private static void AddFilterOverlapWarnings(
        IReadOnlyList<ScheduleCatalogEntry> entries,
        List<RevitDataIssue> issues
    ) {
        var filteredEntries = entries
            .Where(entry => entry.Filters.Count != 0)
            .ToList();
        foreach (var group in filteredEntries
                     .SelectMany(entry => entry.Filters.Select(filter => new { Entry = entry, Filter = filter }))
                     .Where(item => !string.IsNullOrWhiteSpace(item.Filter.Value))
                     .GroupBy(item => $"{item.Entry.CategoryName}|{item.Filter.FieldName}", StringComparer.OrdinalIgnoreCase)) {
            var broadFilters = group
                .Where(item => item.Filter.FilterType == ScheduleAuthoredFilterType.Contains)
                .ToList();
            foreach (var broad in broadFilters) {
                var broadValue = broad.Filter.Value ?? string.Empty;
                foreach (var other in group) {
                    if (ReferenceEquals(broad, other) || string.Equals(broad.Entry.Name, other.Entry.Name, StringComparison.OrdinalIgnoreCase))
                        continue;
                    if (other.Filter.FilterType is not (ScheduleAuthoredFilterType.BeginsWith or ScheduleAuthoredFilterType.Equal or ScheduleAuthoredFilterType.Contains))
                        continue;
                    var otherValue = other.Filter.Value ?? string.Empty;
                    if (!Overlaps(broadValue, otherValue))
                        continue;

                    issues.Add(new RevitDataIssue(
                        "ScheduleFilterOverlapRisk",
                        RevitDataIssueSeverity.Warning,
                        $"Schedule '{broad.Entry.Name}' has broad filter {broad.Filter.FieldName} Contains '{broadValue}' that may overlap '{other.Entry.Name}' filter {other.Filter.FilterType} '{otherValue}'.",
                        TypeName: broad.Entry.Name,
                        ParameterName: broad.Filter.FieldName
                    ));
                }
            }
        }
    }

    private static bool Overlaps(string broadValue, string otherValue) {
        if (string.IsNullOrWhiteSpace(broadValue) || string.IsNullOrWhiteSpace(otherValue))
            return false;
        var broad = broadValue.Trim();
        var other = otherValue.Trim();
        return other.Contains(broad, StringComparison.OrdinalIgnoreCase)
               || broad.Contains(other, StringComparison.OrdinalIgnoreCase);
    }

    private static bool MatchesPreProjectionFilter(
        ViewSchedule schedule,
        HashSet<string> categoryNames,
        HashSet<string> scheduleNames,
        IReadOnlyList<ScheduleCustomParameterFilter> customParameterFilters,
        ScheduleCatalogRequest? request
    ) {
        if (scheduleNames.Count != 0 && !scheduleNames.Contains(schedule.Name))
            return false;

        if (!Contains(schedule.Name, request?.ScheduleNameContains))
            return false;

        if (!StartsWith(schedule.Name, request?.ScheduleNamePrefix))
            return false;

        if (!ScheduleCollectorSupport.MatchesCustomParameterFilters(schedule, customParameterFilters))
            return false;

        if (categoryNames.Count == 0)
            return true;

        var categoryName = ScheduleCollectorSupport.GetCategoryName(schedule.Document, schedule);
        return !string.IsNullOrWhiteSpace(categoryName) && categoryNames.Contains(categoryName);
    }

    private static bool MatchesSheetOnlyFilter(ScheduleCatalogEntry entry, ScheduleCatalogRequest request) {
        if (request.PlacementScope == SchedulePlacementScope.PlacedOnly && !entry.IsPlacedOnSheet)
            return false;
        if (request.PlacementScope == SchedulePlacementScope.UnplacedOnly && entry.IsPlacedOnSheet)
            return false;
        if (!string.IsNullOrWhiteSpace(request.SheetNumberContains)
            && !entry.SheetPlacements.Any(sheet => Contains(sheet.SheetNumber, request.SheetNumberContains)))
            return false;
        if (!string.IsNullOrWhiteSpace(request.SheetNameContains)
            && !entry.SheetPlacements.Any(sheet => Contains(sheet.SheetName, request.SheetNameContains)))
            return false;

        return true;
    }

    private static bool MatchesPostProjectionFilter(
        ScheduleCatalogEntry entry,
        ScheduleCatalogRequest? request
    ) {
        if (request == null)
            return true;

        if (request.PlacementScope == SchedulePlacementScope.PlacedOnly && !entry.IsPlacedOnSheet)
            return false;
        if (request.PlacementScope == SchedulePlacementScope.UnplacedOnly && entry.IsPlacedOnSheet)
            return false;
        if (request.IsEmpty != null && (entry.VisibleBodyRowCount == 0) != request.IsEmpty.Value)
            return false;
        if (!string.IsNullOrWhiteSpace(request.SheetNumberContains)
            && !entry.SheetPlacements.Any(sheet => Contains(sheet.SheetNumber, request.SheetNumberContains)))
            return false;
        if (!string.IsNullOrWhiteSpace(request.SheetNameContains)
            && !entry.SheetPlacements.Any(sheet => Contains(sheet.SheetName, request.SheetNameContains)))
            return false;

        return true;
    }

    private static bool Contains(string? value, string? expected) =>
        string.IsNullOrWhiteSpace(expected)
        || (!string.IsNullOrWhiteSpace(value)
            && value.Contains(expected.Trim(), StringComparison.OrdinalIgnoreCase));

    private static bool StartsWith(string? value, string? expected) =>
        string.IsNullOrWhiteSpace(expected)
        || (!string.IsNullOrWhiteSpace(value)
            && value.StartsWith(expected.Trim(), StringComparison.OrdinalIgnoreCase));
}
