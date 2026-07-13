using Pe.Revit.DocumentData.ProjectBrowser;
using Pe.Revit.DocumentData.Schedules.Apply;
using Pe.Shared.RevitData;
using Pe.Shared.RevitData.Schedules;
using Serilog;
using System.Diagnostics;
using System.Text;
using System.Text.RegularExpressions;

namespace Pe.Revit.DocumentData.Schedules.Collect;

public static partial class ScheduleCatalogCollector {
    private const long SlowScheduleCatalogEntryThresholdMs = 150;

    public static ScheduleCatalogData Collect(
        Document doc,
        ScheduleCatalogRequest? request = null,
        IProjectBrowserIndexProvider? browserIndexProvider = null
    ) {
        var categoryNames = ScheduleCollectorSupport.ToFilterSet(request?.CategoryNames);
        var scheduleNames = ScheduleCollectorSupport.ToFilterSet(request?.ScheduleNames);
        var customParameterFilters = request?.CustomParameterFilters ?? [];
        var includeTemplates = request?.IncludeTemplates ?? false;
        var projection = request?.Projection ?? new ScheduleCatalogProjection();
        var budget = RevitDataOutputBudgets.WithDefaults(request?.Budget, maxEntries: 25);
        var maxEntries = budget.MaxEntries;
        var issues = new List<RevitDataIssue>();
        var totalStopwatch = Stopwatch.StartNew();
        var shouldCollectBrowserIndex = request?.BrowserFilter != null || projection.View is RevitDataResultView.Handles or RevitDataResultView.Rows or RevitDataResultView.Full;
        var browserIndex = TimePhase("browser-index", () => shouldCollectBrowserIndex
            ? browserIndexProvider?.GetProjectBrowserIndex(
                  doc,
                  new HashSet<ProjectBrowserSection> { ProjectBrowserSection.Schedules },
                  Math.Max(0, budget.MaxSamplesPerEntry ?? 5),
                  ProjectBrowserResultView.Folders,
                  request?.BrowserFilter == null ? null : request.BrowserFilter with { Section = ProjectBrowserSection.Schedules },
                  issues
              )
              ?? ProjectBrowserCollector.CollectIndex(
                  doc,
                  new HashSet<ProjectBrowserSection> { ProjectBrowserSection.Schedules },
                  Math.Max(0, budget.MaxSamplesPerEntry ?? 5),
                  ProjectBrowserResultView.Folders,
                  request?.BrowserFilter == null ? null : request.BrowserFilter with { Section = ProjectBrowserSection.Schedules },
                  issues
              )
            : ProjectBrowserCollectedIndex.Empty);
        var requireVisibleBodyRows = request?.IsEmpty != null;

        var allEntries = TimePhase("entries", () => new FilteredElementCollector(doc)
            .OfClass(typeof(ViewSchedule))
            .Cast<ViewSchedule>()
            .Where(schedule => includeTemplates || !schedule.IsTemplate)
            .Where(schedule => !schedule.Name.Contains("<Revision Schedule>", StringComparison.OrdinalIgnoreCase))
            .Where(schedule => MatchesPreProjectionFilter(schedule, categoryNames, scheduleNames, customParameterFilters, request))
            .OrderBy(schedule => schedule.Name, StringComparer.OrdinalIgnoreCase)
            .Select(schedule => TryCollectEntry(doc, schedule, projection, issues, requireVisibleBodyRows))
            .Where(entry => entry != null)
            .Cast<ScheduleCatalogEntry>()
            .Select(entry => AttachBrowserPaths(entry, browserIndex, request))
            .Where(entry => MatchesBrowserFilter(entry, request))
            .Where(entry => MatchesPostProjectionFilter(entry, request))
            .ToList());

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
        if (budget.IncludeDiagnostics) {
            AddFilterOverlapWarnings(entries, issues);
            AddSheetFilterDiagnostics(doc, request, projection, browserIndex, allEntries, entries, issues);
        }
        Log.Debug("ScheduleCatalog collected in {ElapsedMilliseconds} ms with {MatchedCount} matching schedule(s) and {ReturnedCount} returned schedule(s)", totalStopwatch.ElapsedMilliseconds, allEntries.Count, entries.Count);

        return new ScheduleCatalogData(
            entries,
            RevitDataOutputBudgets.ProjectIssues(issues, budget),
            new RevitDataResultPage(allEntries.Count, entries.Count, truncated),
            BuildSummary(allEntries)
        );
    }

    private static ScheduleCatalogEntry AttachBrowserPaths(ScheduleCatalogEntry entry, ProjectBrowserCollectedIndex browserIndex, ScheduleCatalogRequest? request) {
        var includeBrowserPaths = request?.BrowserFilter != null || request?.Projection?.View is RevitDataResultView.Handles or RevitDataResultView.Rows or RevitDataResultView.Full;
        var paths = browserIndex.Get(ProjectBrowserSection.Schedules, entry.ScheduleId.ToElementId(), includeBrowserPaths);
        return entry with { BrowserPaths = paths };
    }

    private static bool MatchesBrowserFilter(ScheduleCatalogEntry entry, ScheduleCatalogRequest? request) => request?.BrowserFilter == null || entry.BrowserPaths.Count != 0;

    private static ScheduleCatalogEntry? TryCollectEntry(
        Document doc,
        ViewSchedule schedule,
        ScheduleCatalogProjection projection,
        List<RevitDataIssue> issues,
        bool requireVisibleBodyRows = false
    ) {
        var totalStopwatch = Stopwatch.StartNew();
        long profileMs = 0;
        long sheetPlacementsMs = 0;
        long visibleFamilyInstancesMs = 0;
        long visibleFamiliesMs = 0;
        long visibleBodyRowCountMs = 0;
        long parameterUsagesMs = 0;
        long customParametersMs = 0;

        try {
            var includeAll = projection.View == RevitDataResultView.Full;
            var includeProfile = includeAll || projection.View is RevitDataResultView.Rows || projection.IncludeFilters;
            var categoryName = ScheduleCollectorSupport.GetCategoryName(doc, schedule);
            var profile = includeProfile
                ? Measure(
                    () => ScheduleHelper.SerializeSchedule(schedule),
                    out profileMs
                )
                : new ScheduleProfile(schedule.Name, categoryName ?? string.Empty);
            var sheetPlacements = Measure(
                () => ScheduleCollectorSupport.CollectSheetPlacements(doc, schedule),
                out sheetPlacementsMs
            );
            var includeVisibleFamilies = projection.IncludeVisibleFamilies || includeAll;
            var includeVisibleBodyRowCount = includeVisibleFamilies || requireVisibleBodyRows;
            var visibleFamilyInstances = includeVisibleFamilies
                ? Measure(
                    () => ScheduleVisibleFamilyCollector.CollectVisibleFamilyInstances(doc, schedule),
                    out visibleFamilyInstancesMs
                )
                : [];
            var visibleFamilies = includeVisibleFamilies
                ? Measure(
                    () => ScheduleVisibleFamilyCollector.CollectVisibleFamilies(visibleFamilyInstances),
                    out visibleFamiliesMs
                )
                : [];
            var visibleBodyRowCount = includeVisibleBodyRowCount
                ? Measure(
                    () => ScheduleVisibleFamilyCollector.GetVisibleBodyRowCount(doc, schedule),
                    out visibleBodyRowCountMs
                )
                : 0;
            var visibleInstanceCount = includeVisibleFamilies ? visibleFamilyInstances.Count : 0;
            var parameterUsages = projection.IncludeParameterUsages || includeAll
                ? Measure(
                    () => ScheduleCollectorSupport.CollectParameterUsages(doc, schedule),
                    out parameterUsagesMs
                )
                : [];
            var customParameters = projection.IncludeCustomParameters || includeAll
                ? Measure(
                    () => ScheduleCollectorSupport.CollectCustomParameters(schedule),
                    out customParametersMs
                )
                : [];

            LogSlowCatalogEntry(
                schedule,
                totalStopwatch.ElapsedMilliseconds,
                profileMs,
                sheetPlacementsMs,
                visibleFamilyInstancesMs,
                visibleFamiliesMs,
                visibleBodyRowCountMs,
                parameterUsagesMs,
                customParametersMs,
                sheetPlacements.Count,
                visibleBodyRowCount,
                visibleFamilyInstances.Count,
                visibleFamilies.Count,
                parameterUsages.Count,
                customParameters.Count
            );

            return new ScheduleCatalogEntry(
                schedule.Id.Value(),
                schedule.UniqueId,
                schedule.Name,
                categoryName,
                schedule.IsTemplate,
                profile.ViewTemplateName,
                profile.IsItemized,
                profile.FilterBySheet,
                sheetPlacements.Count != 0,
                projection.IncludeSheetPlacements || includeAll ? sheetPlacements : [],
                projection.IncludeFilters || includeAll ? profile.Filters ?? [] : [],
                parameterUsages,
                customParameters,
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

    private static void LogSlowCatalogEntry(
        ViewSchedule schedule,
        long totalMs,
        long profileMs,
        long sheetPlacementsMs,
        long visibleFamilyInstancesMs,
        long visibleFamiliesMs,
        long visibleBodyRowCountMs,
        long parameterUsagesMs,
        long customParametersMs,
        int sheetPlacementCount,
        int visibleBodyRowCount,
        int visibleInstanceCount,
        int visibleFamilyCount,
        int parameterUsageCount,
        int customParameterCount
    ) {
        if (totalMs < SlowScheduleCatalogEntryThresholdMs)
            return;

        Log.Information(
            "ScheduleCatalog slow entry: Schedule={ScheduleName}, ScheduleId={ScheduleId}, TotalMs={TotalMs}, ProfileMs={ProfileMs}, SheetPlacementsMs={SheetPlacementsMs}, VisibleFamilyInstancesMs={VisibleFamilyInstancesMs}, VisibleFamiliesMs={VisibleFamiliesMs}, VisibleBodyRowCountMs={VisibleBodyRowCountMs}, ParameterUsagesMs={ParameterUsagesMs}, CustomParametersMs={CustomParametersMs}, SheetPlacements={SheetPlacements}, VisibleBodyRows={VisibleBodyRows}, VisibleInstances={VisibleInstances}, VisibleFamilies={VisibleFamilies}, ParameterUsages={ParameterUsages}, CustomParameters={CustomParameters}",
            schedule.Name,
            schedule.Id.Value(),
            totalMs,
            profileMs,
            sheetPlacementsMs,
            visibleFamilyInstancesMs,
            visibleFamiliesMs,
            visibleBodyRowCountMs,
            parameterUsagesMs,
            customParametersMs,
            sheetPlacementCount,
            visibleBodyRowCount,
            visibleInstanceCount,
            visibleFamilyCount,
            parameterUsageCount,
            customParameterCount
        );
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
        var diagnosticProjection = new ScheduleCatalogProjection {
            View = RevitDataResultView.Handles,
            IncludeSheetPlacements = true
        };
        return TimePhase("sheet-filter-diagnostics", () => new FilteredElementCollector(doc)
            .OfClass(typeof(ViewSchedule))
            .Cast<ViewSchedule>()
            .Where(schedule => request.IncludeTemplates || !schedule.IsTemplate)
            .Where(schedule => !schedule.Name.Contains("<Revision Schedule>", StringComparison.OrdinalIgnoreCase))
            .OrderBy(schedule => schedule.Name, StringComparer.OrdinalIgnoreCase)
            .Select(schedule => TryCollectEntry(doc, schedule, diagnosticProjection, diagnosticIssues))
            .Where(entry => entry != null)
            .Cast<ScheduleCatalogEntry>()
            .Select(entry => AttachBrowserPaths(entry, browserIndex, request))
            .Where(entry => MatchesSheetOnlyFilter(entry, request))
            .Take(25)
            .ToList());
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

    private static T TimePhase<T>(string phase, Func<T> action) {
        var stopwatch = Stopwatch.StartNew();
        var result = action();
        Log.Debug("ScheduleCatalog {Phase} collected in {ElapsedMilliseconds} ms", phase, stopwatch.ElapsedMilliseconds);
        return result;
    }

    private static T Measure<T>(Func<T> action, out long elapsedMilliseconds) {
        var stopwatch = Stopwatch.StartNew();
        var result = action();
        elapsedMilliseconds = stopwatch.ElapsedMilliseconds;
        return result;
    }

    private static ScheduleCatalogSummary BuildSummary(IReadOnlyList<ScheduleCatalogEntry> entries) {
        var duplicateGroups = entries
            .GroupBy(entry => NormalizeRevitDuplicateName(entry.Name), StringComparer.OrdinalIgnoreCase)
            .Where(group => group.Count() > 1)
            .OrderByDescending(group => group.Count())
            .ThenBy(group => group.Key, StringComparer.OrdinalIgnoreCase)
            .Select(group => new ScheduleCatalogNameGroup(
                group.Key,
                group.Count(),
                group.Select(entry => entry.Name).Distinct(StringComparer.OrdinalIgnoreCase).OrderBy(name => name, StringComparer.OrdinalIgnoreCase).ToList()
            ))
            .ToList();

        var normalizedNames = entries.Select(entry => NormalizeRevitDuplicateName(entry.Name)).ToList();
        var prefixCounts = CountNameTokens(normalizedNames, first: true);
        var suffixCounts = CountNameTokens(normalizedNames, first: false);
        var topScheduledFields = entries
            .SelectMany(entry => entry.ParameterUsages
                .Where(usage => !string.IsNullOrWhiteSpace(usage.FieldName))
                .Select(usage => new { usage.FieldName, usage.FieldIndex, entry.ScheduleId }))
            .GroupBy(item => item.FieldName, StringComparer.OrdinalIgnoreCase)
            .OrderByDescending(group => group.Select(item => item.ScheduleId).Distinct().Count())
            .ThenBy(group => group.Key, StringComparer.OrdinalIgnoreCase)
            .Take(25)
            .Select(group => new ScheduleCatalogFieldUsageSummary(
                group.Key,
                group.Select(item => item.ScheduleId).Distinct().Count(),
                Math.Round(group.Average(item => item.FieldIndex), 2)
            ))
            .ToList();
        var fingerprints = entries
            .Where(entry => entry.ParameterUsages.Count != 0)
            .Select(BuildFieldFingerprint)
            .ToList();

        return new ScheduleCatalogSummary(
            entries.Count,
            duplicateGroups,
            prefixCounts,
            suffixCounts,
            topScheduledFields,
            fingerprints
        );
    }

    private static ScheduleCatalogFieldFingerprint BuildFieldFingerprint(ScheduleCatalogEntry entry) {
        var fieldSequence = entry.ParameterUsages
            .OrderBy(usage => usage.FieldIndex)
            .Select(usage => usage.FieldName)
            .Where(name => !string.IsNullOrWhiteSpace(name))
            .ToList();
        var fieldSet = fieldSequence.Distinct(StringComparer.OrdinalIgnoreCase).OrderBy(name => name, StringComparer.OrdinalIgnoreCase);
        return new ScheduleCatalogFieldFingerprint(
            entry.ScheduleId,
            entry.Name,
            NormalizeRevitDuplicateName(entry.Name),
            fieldSequence,
            HashFields(fieldSet),
            HashFields(fieldSequence),
            fieldSequence
                .Select(GetParameterPrefix)
                .OfType<string>()
                .GroupBy(prefix => prefix, StringComparer.OrdinalIgnoreCase)
                .OrderByDescending(group => group.Count())
                .ThenBy(group => group.Key, StringComparer.OrdinalIgnoreCase)
                .ToDictionary(group => group.Key, group => group.Count(), StringComparer.OrdinalIgnoreCase)
        );
    }

    private static List<ScheduleCatalogNameTokenCount> CountNameTokens(IEnumerable<string> names, bool first) => names
        .Select(name => SplitNameTokens(name))
        .Select(tokens => first ? tokens.FirstOrDefault() : tokens.LastOrDefault())
        .Where(token => !string.IsNullOrWhiteSpace(token))
        .GroupBy(token => token!, StringComparer.OrdinalIgnoreCase)
        .OrderByDescending(group => group.Count())
        .ThenBy(group => group.Key, StringComparer.OrdinalIgnoreCase)
        .Take(25)
        .Select(group => new ScheduleCatalogNameTokenCount(group.Key, group.Count()))
        .ToList();

    private static string NormalizeRevitDuplicateName(string name) => RevitDuplicateSuffixRegex()
        .Replace(name.Trim(), string.Empty)
        .Trim();

    private static List<string> SplitNameTokens(string name) => name
        .SplitAndTrim([' ', '-', '_', '/', '\\'], BclCompat.RemoveEmptyAndTrimEntries)
        .ToList();

    private static string? GetParameterPrefix(string fieldName) {
        var index = fieldName.IndexOf('_');
        return index <= 0 ? null : fieldName[..index];
    }

    private static string HashFields(IEnumerable<string> fields) {
        var bytes = BclCompat.ComputeSha256Hash(Encoding.UTF8.GetBytes(string.Join("\u001f", fields)));
        return BclCompat.ToHexString(bytes)[..16];
    }

    private static Regex RevitDuplicateSuffixRegex() => DuplicateSuffixRegex;

    private static readonly Regex DuplicateSuffixRegex = new(
        @"\s+(?:\(\d+\)|Copy\s+\d+)\s*$",
        RegexOptions.IgnoreCase | RegexOptions.CultureInvariant
    );

    private static bool Contains(string? value, string? expected) =>
        string.IsNullOrWhiteSpace(expected)
        || (!string.IsNullOrWhiteSpace(value)
            && value.Contains(expected.Trim(), StringComparison.OrdinalIgnoreCase));

    private static bool StartsWith(string? value, string? expected) =>
        string.IsNullOrWhiteSpace(expected)
        || (!string.IsNullOrWhiteSpace(value)
            && value.StartsWith(expected.Trim(), StringComparison.OrdinalIgnoreCase));
}
