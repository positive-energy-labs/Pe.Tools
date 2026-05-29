using Pe.Revit.DocumentData.ProjectBrowser;
using Pe.Shared.RevitData;
using Pe.Shared.RevitData.Schedules;
using Serilog;
using System.Diagnostics;

namespace Pe.Revit.DocumentData.Schedules.Collect;

public static class ScheduleCoverageCollector {
    public static ScheduleCoverageData Collect(
        Document doc,
        ScheduleCoverageRequest request,
        View? activeView = null,
        IProjectBrowserIndexProvider? browserIndexProvider = null
    ) {
        var totalStopwatch = Stopwatch.StartNew();
        var issues = new List<RevitDataIssue>();
        var budget = RevitDataOutputBudgets.WithDefaults(request.Budget, maxEntries: 50);
        var categoryNames = request.CategoryNames
            .Where(name => !string.IsNullOrWhiteSpace(name))
            .Select(name => name.Trim())
            .ToHashSet(StringComparer.OrdinalIgnoreCase);
        var maxElements = budget.MaxEntries;
        var includeSamples = request.IncludeElementSamples || budget.MaxSamplesPerEntry is > 0;
        var sampleLimit = budget.MaxSamplesPerEntry;

        var elements = TimePhase("elements", () => ResolveElements(doc, request, activeView, issues)
            .Where(element => categoryNames.Count == 0 || categoryNames.Contains(element.Category!.Name))
            .Select(element => new {
                Element = element,
                Handle = CreateElementHandle(doc, element)
            })
            .OrderBy(item => item.Handle.CategoryName, StringComparer.OrdinalIgnoreCase)
            .ThenBy(item => item.Handle.DisplayName, StringComparer.OrdinalIgnoreCase)
            .ToList());

        var scheduleFilter = request.ScheduleFilter ?? new ScheduleCatalogRequest {
            CategoryNames = request.CategoryNames,
            Projection = new ScheduleCatalogProjection {
                View = RevitDataResultView.Handles,
                IncludeSheetPlacements = true
            },
            Budget = budget
        };
        var catalog = TimePhase("schedule-catalog", () => ScheduleCatalogCollector.Collect(doc, scheduleFilter, browserIndexProvider));
        issues.AddRange(catalog.Issues);

        var subjectHits = TimePhase(
            "schedule-subjects",
            () => CollectScheduleSubjectHits(doc, catalog.Entries, request.ScheduleRoleScope, issues)
        );
        var hitsByElementId = subjectHits.HitsByElementId;

        var entries = elements
            .Select(item => new ScheduleCoverageElementEntry(
                item.Handle,
                hitsByElementId.TryGetValue(item.Handle.ElementId, out var hits)
                    ? hits.GroupBy(hit => hit.ScheduleId).Select(group => group.First()).ToList()
                    : []
            ))
            .ToList();
        var covered = entries.Count(entry => entry.MatchingSchedules.Count != 0);
        AddScheduleRoleScopeDiagnostics(request.ScheduleRoleScope, catalog.Entries.Count, subjectHits.KeptScheduleCount, entries.Count, covered, issues);
        var projectedEntries = includeSamples
            ? entries.Where(entry => entry.MatchingSchedules.Count == 0).Concat(entries.Where(entry => entry.MatchingSchedules.Count != 0))
            : [];
        if (sampleLimit is > 0)
            projectedEntries = projectedEntries.Take(sampleLimit.Value);
        if (maxElements is > 0)
            projectedEntries = projectedEntries.Take(maxElements.Value);
        var returned = projectedEntries.ToList();
        var missingHandles = request.IncludeMissingElementHandles
            ? entries
                .Where(entry => entry.MatchingSchedules.Count == 0)
                .Select(entry => entry.Element)
                .Take(maxElements ?? entries.Count)
                .ToList()
            : null;
        var matchedScheduleNames = request.IncludeMatchedScheduleNames
            ? entries
                .SelectMany(entry => entry.MatchingSchedules.Select(schedule => schedule.ScheduleName))
                .Where(name => !string.IsNullOrWhiteSpace(name))
                .Distinct(StringComparer.OrdinalIgnoreCase)
                .OrderBy(name => name, StringComparer.OrdinalIgnoreCase)
                .ToList()
            : null;
        var roleSummaries = CreateRoleSummaries(entries);
        var truncated = returned.Count < entries.Count && includeSamples;
        if (truncated) {
            issues.Add(new RevitDataIssue(
                "ScheduleCoverageTruncated",
                RevitDataIssueSeverity.Warning,
                $"Returned {returned.Count} of {entries.Count} schedule coverage element sample(s). Increase budget.maxEntries or budget.maxSamplesPerEntry to expand."
            ));
        }

        Log.Debug("ScheduleCoverage collected in {ElapsedMilliseconds} ms with {ElementCount} scoped element(s), {ScheduleCount} schedule candidate(s), and {CoveredCount} covered element(s)", totalStopwatch.ElapsedMilliseconds, entries.Count, catalog.Entries.Count, covered);
        return new ScheduleCoverageData(
            entries.Count,
            covered,
            entries.Count - covered,
            catalog.Entries.Count,
            returned,
            RevitDataOutputBudgets.ProjectIssues(issues, budget),
            new RevitDataResultPage(entries.Count, returned.Count, truncated),
            missingHandles,
            matchedScheduleNames,
            roleSummaries
        );
    }

    private static List<Element> ResolveElements(
        Document doc,
        ScheduleCoverageRequest request,
        View? activeView,
        List<RevitDataIssue> issues
    ) {
        if (request.Scope == RevitElementScope.ActiveViewVisible) {
            if (activeView == null) {
                issues.Add(new RevitDataIssue(
                    "ScheduleCoverageNoActiveView",
                    RevitDataIssueSeverity.Warning,
                    "No active view was available; schedule coverage fell back to all document elements."
                ));
            } else {
                return new FilteredElementCollector(doc, activeView.Id)
                    .WhereElementIsNotElementType()
                    .Where(element => element.Category != null)
                    .ToList();
            }
        }

        if (request.Scope == RevitElementScope.ViewReferences) {
            var visibleViews = ResolveViewReferences(doc, request, issues);
            if (visibleViews.Count == 0) {
                issues.Add(new RevitDataIssue(
                    "ScheduleCoverageViewReferencesRequired",
                    RevitDataIssueSeverity.Warning,
                    "ViewReferences scope requires at least one resolvable view id or unique id."
                ));
                return [];
            }

            return visibleViews
                .SelectMany(view => {
                    try {
                        return new FilteredElementCollector(doc, view.Id)
                            .WhereElementIsNotElementType()
                            .Where(element => element.Category != null)
                            .ToList();
                    } catch (Exception ex) {
                        issues.Add(new RevitDataIssue(
                            "ScheduleCoverageViewCollectFailed",
                            RevitDataIssueSeverity.Warning,
                            $"Failed to collect visible elements from view '{view.Title}': {ex.Message}",
                            TypeName: view.GetType().Name
                        ));
                        return [];
                    }
                })
                .GroupBy(element => element.Id.Value())
                .Select(group => group.First())
                .ToList();
        }

        if (request.Scope == RevitElementScope.ExplicitHandles) {
            var elements = new List<Element>();
            var missingIds = new List<long>();
            var missingUniqueIds = new List<string>();
            foreach (var id in request.ElementIds.Distinct()) {
                var element = doc.GetElement(id.ToElementId());
                if (element == null) {
                    missingIds.Add(id);
                    continue;
                }
                elements.Add(element);
            }
            foreach (var uniqueId in request.ElementUniqueIds.Where(value => !string.IsNullOrWhiteSpace(value)).Distinct(StringComparer.OrdinalIgnoreCase)) {
                var element = doc.GetElement(uniqueId);
                if (element == null) {
                    missingUniqueIds.Add(uniqueId);
                    continue;
                }
                elements.Add(element);
            }

            if (missingIds.Count != 0 || missingUniqueIds.Count != 0) {
                issues.Add(new RevitDataIssue(
                    "ScheduleCoverageMissingExplicitHandles",
                    RevitDataIssueSeverity.Warning,
                    $"Could not resolve {missingIds.Count} element id(s) and {missingUniqueIds.Count} element unique id(s) from explicit schedule coverage handles."
                ));
            }

            return elements
                .GroupBy(element => element.Id.Value())
                .Select(group => group.First())
                .Where(element => element.Category != null)
                .ToList();
        }

        return new FilteredElementCollector(doc)
            .WhereElementIsNotElementType()
            .Where(element => element.Category != null)
            .ToList();
    }


    private static List<View> ResolveViewReferences(
        Document doc,
        ScheduleCoverageRequest request,
        List<RevitDataIssue> issues
    ) {
        var views = new List<View>();
        var seenViewIds = new HashSet<long>();
        foreach (var viewId in request.ViewIds.Distinct())
            AddViewReference(doc, doc.GetElement(viewId.ToElementId()), $"view id {viewId}", views, seenViewIds, issues);
        foreach (var uniqueId in request.ViewUniqueIds
                     .Where(value => !string.IsNullOrWhiteSpace(value))
                     .Select(value => value.Trim())
                     .Distinct(StringComparer.Ordinal))
            AddViewReference(doc, doc.GetElement(uniqueId), $"view unique id '{uniqueId}'", views, seenViewIds, issues);
        return views;
    }

    private static void AddViewReference(
        Document doc,
        Element? element,
        string label,
        List<View> views,
        HashSet<long> seenViewIds,
        List<RevitDataIssue> issues
    ) {
        if (element is ViewSheet sheet) {
            foreach (var placedView in sheet.GetAllPlacedViews()
                         .Select(doc.GetElement)
                         .OfType<View>()
                         .Where(view => !view.IsTemplate)) {
                if (seenViewIds.Add(placedView.Id.Value()))
                    views.Add(placedView);
            }
            return;
        }

        if (element is not View view) {
            issues.Add(new RevitDataIssue(
                "ScheduleCoverageViewReferenceNotFound",
                RevitDataIssueSeverity.Warning,
                $"Could not resolve {label} to a Revit view.",
                TypeName: nameof(View)
            ));
            return;
        }

        if (view.IsTemplate) {
            issues.Add(new RevitDataIssue(
                "ScheduleCoverageViewReferenceTemplate",
                RevitDataIssueSeverity.Warning,
                $"Resolved {label} to template view '{view.Title}', which cannot be used for visible element collection.",
                TypeName: nameof(View)
            ));
            return;
        }

        if (seenViewIds.Add(view.Id.Value()))
            views.Add(view);
    }

    private static ScheduleSubjectHitIndex CollectScheduleSubjectHits(
        Document doc,
        IReadOnlyList<ScheduleCatalogEntry> schedules,
        ScheduleRoleScope roleScope,
        List<RevitDataIssue> issues
    ) {
        var hitsByElementId = new Dictionary<long, List<ScheduleCoverageScheduleHit>>();
        var keptScheduleCount = 0;

        foreach (var entry in schedules) {
            if (doc.GetElement(entry.ScheduleId.ToElementId()) is not ViewSchedule schedule) {
                issues.Add(new RevitDataIssue(
                    "ScheduleCoverageScheduleNotFound",
                    RevitDataIssueSeverity.Warning,
                    $"Could not resolve schedule '{entry.Name}' from id {entry.ScheduleId}.",
                    TypeName: nameof(ViewSchedule),
                    ParameterName: entry.Name
                ));
                continue;
            }

            var hit = new ScheduleCoverageScheduleHit(
                entry.ScheduleId,
                entry.ScheduleUniqueId,
                entry.Name,
                entry.IsPlacedOnSheet,
                entry.SheetPlacements
            );
            if (!MatchesScheduleRoleScope(hit, roleScope))
                continue;

            keptScheduleCount++;
            foreach (var subject in ScheduleRenderedSubjectCollector.CollectVisibleSubjects(doc, schedule)) {
                var subjectId = subject.Id.Value();
                if (!hitsByElementId.TryGetValue(subjectId, out var hits)) {
                    hits = [];
                    hitsByElementId[subjectId] = hits;
                }

                hits.Add(hit);
            }
        }

        return new ScheduleSubjectHitIndex(hitsByElementId, keptScheduleCount);
    }

    private static List<ScheduleCoverageRoleSummary> CreateRoleSummaries(IReadOnlyList<ScheduleCoverageElementEntry> entries) => entries
        .SelectMany(entry => entry.MatchingSchedules.Select(schedule => new {
            Entry = entry,
            Schedule = schedule,
            Role = GetCoverageRole(schedule)
        }))
        .GroupBy(item => item.Role, StringComparer.OrdinalIgnoreCase)
        .Select(group => new ScheduleCoverageRoleSummary(
            group.Key,
            group.Select(item => item.Schedule.ScheduleId).Distinct().Count(),
            group.Select(item => item.Entry.Element.ElementId).Distinct().Count(),
            group.Select(item => item.Schedule.ScheduleName)
                .Distinct(StringComparer.OrdinalIgnoreCase)
                .OrderBy(name => name, StringComparer.OrdinalIgnoreCase)
                .ToList()
        ))
        .OrderBy(summary => summary.Role, StringComparer.OrdinalIgnoreCase)
        .ToList();

    private static string GetCoverageRole(ScheduleCoverageScheduleHit hit) {
        if (hit.SheetPlacements.Any(placement => string.Equals(placement.SheetRole, "Issued", StringComparison.OrdinalIgnoreCase) || placement.IsIssuedLikeSheet))
            return "Issued";
        if (hit.SheetPlacements.Any(placement => string.Equals(placement.SheetRole, "Working", StringComparison.OrdinalIgnoreCase) || placement.IsWorkingLikeSheet))
            return "Working";
        if (hit.SheetPlacements.Any(placement => string.Equals(placement.SheetRole, "Archive", StringComparison.OrdinalIgnoreCase)))
            return "Archive";
        return hit.IsPlacedOnSheet ? "PlacedOther" : "Unplaced";
    }

    private static T TimePhase<T>(string phase, Func<T> action) {
        var stopwatch = Stopwatch.StartNew();
        var result = action();
        Log.Debug("ScheduleCoverage {Phase} collected in {ElapsedMilliseconds} ms", phase, stopwatch.ElapsedMilliseconds);
        return result;
    }

    private static bool MatchesScheduleRoleScope(ScheduleCoverageScheduleHit hit, ScheduleRoleScope scope) {
        if (scope == ScheduleRoleScope.All)
            return true;
        if (hit.SheetPlacements.Count == 0)
            return false;

        return scope switch {
            ScheduleRoleScope.IssuedOnly => hit.SheetPlacements.Any(placement => string.Equals(placement.SheetRole, "Issued", StringComparison.OrdinalIgnoreCase) || placement.IsIssuedLikeSheet),
            ScheduleRoleScope.WorkingOnly => hit.SheetPlacements.Any(placement => string.Equals(placement.SheetRole, "Working", StringComparison.OrdinalIgnoreCase) || placement.IsWorkingLikeSheet),
            ScheduleRoleScope.ArchiveOnly => hit.SheetPlacements.Any(placement => string.Equals(placement.SheetRole, "Archive", StringComparison.OrdinalIgnoreCase)),
            ScheduleRoleScope.IssuedOrWorking => hit.SheetPlacements.Any(placement => string.Equals(placement.SheetRole, "Issued", StringComparison.OrdinalIgnoreCase) || placement.IsIssuedLikeSheet || string.Equals(placement.SheetRole, "Working", StringComparison.OrdinalIgnoreCase) || placement.IsWorkingLikeSheet),
            _ => true
        };
    }

    private static void AddScheduleRoleScopeDiagnostics(
        ScheduleRoleScope scope,
        int unscopedScheduleCount,
        int scopedScheduleCount,
        int totalElements,
        int coveredElements,
        List<RevitDataIssue> issues
    ) {
        if (scope == ScheduleRoleScope.All || unscopedScheduleCount == scopedScheduleCount)
            return;

        issues.Add(new RevitDataIssue(
            coveredElements == 0 && totalElements != 0 ? "ScheduleCoverageRoleScopeRemovedAllMatches" : "ScheduleCoverageRoleScopeFilteredSchedules",
            RevitDataIssueSeverity.Warning,
            $"scheduleRoleScope={scope} kept {scopedScheduleCount} of {unscopedScheduleCount} candidate schedule(s); {coveredElements} of {totalElements} element(s) remain covered. Use scheduleRoleScope=All to inspect working/issued/archive matches together."
        ));
    }

    private sealed record ScheduleSubjectHitIndex(
        Dictionary<long, List<ScheduleCoverageScheduleHit>> HitsByElementId,
        int KeptScheduleCount
    );

    private static RevitElementHandle CreateElementHandle(Document doc, Element element) {
        var type = doc.GetElement(element.GetTypeId()) as ElementType;
        var familyName = element is FamilyInstance familyInstance
            ? familyInstance.Symbol?.FamilyName
            : type?.FamilyName;
        return new RevitElementHandle(
            element.Id.Value(),
            element.UniqueId,
            string.IsNullOrWhiteSpace(element.Name) ? $"Element {element.Id.Value()}" : element.Name,
            element.Category?.Name,
            familyName,
            type?.Name
        );
    }
}
