using Pe.Shared.RevitData;
using Pe.Shared.RevitData.Schedules;

namespace Pe.Revit.DocumentData.Schedules.Collect;

public static class ScheduleCoverageCollector {
    public static ScheduleCoverageData Collect(Document doc, ScheduleCoverageRequest request) {
        var issues = new List<RevitDataIssue>();
        var budget = RevitDataOutputBudgets.WithDefaults(request.Budget, maxEntries: 50);
        var categoryNames = request.CategoryNames
            .Where(name => !string.IsNullOrWhiteSpace(name))
            .Select(name => name.Trim())
            .ToHashSet(StringComparer.OrdinalIgnoreCase);
        var maxElements = budget.MaxEntries;
        var includeSamples = request.IncludeElementSamples || budget.MaxSamplesPerEntry is > 0;
        var sampleLimit = budget.MaxSamplesPerEntry;

        var elements = new FilteredElementCollector(doc)
            .WhereElementIsNotElementType()
            .Where(element => element.Category != null)
            .Where(element => categoryNames.Count == 0 || categoryNames.Contains(element.Category!.Name))
            .Select(element => new {
                Element = element,
                Handle = CreateElementHandle(doc, element)
            })
            .OrderBy(item => item.Handle.CategoryName, StringComparer.OrdinalIgnoreCase)
            .ThenBy(item => item.Handle.DisplayName, StringComparer.OrdinalIgnoreCase)
            .ToList();

        var scheduleFilter = request.ScheduleFilter ?? new ScheduleCatalogRequest {
            CategoryNames = request.CategoryNames,
            Projection = new ScheduleCatalogProjection {
                View = RevitDataResultView.Handles,
                IncludeSheetPlacements = true
            },
            Budget = budget
        };
        var catalog = ScheduleCatalogCollector.Collect(doc, scheduleFilter);
        issues.AddRange(catalog.Issues);

        var scheduleNames = catalog.Entries.Select(entry => entry.Name).Distinct(StringComparer.OrdinalIgnoreCase).ToList();
        var query = new ScheduleQuery(
            ScheduleQueryKind.ScheduleNames,
            ScheduleNames: scheduleNames,
            Projection: new ScheduleQueryProjection {
                View = RevitDataResultView.Handles,
                IncludeSubjects = true
            },
            Budget: budget
        );
        var detail = scheduleNames.Count == 0
            ? new ScheduleQueryData(doc.Title, ScheduleQueryKind.ScheduleNames, 0, 0, [], [], null)
            : ScheduleQueryCollector.Collect(doc, query, null);
        issues.AddRange(detail.Issues);

        var hitsByElementId = new Dictionary<long, List<ScheduleCoverageScheduleHit>>();
        foreach (var schedule in detail.Entries) {
            var hit = new ScheduleCoverageScheduleHit(
                schedule.ScheduleId,
                schedule.ScheduleUniqueId,
                schedule.ScheduleName,
                schedule.IsPlacedOnSheet,
                schedule.SheetPlacements
            );
            if (!MatchesScheduleRoleScope(hit, request.ScheduleRoleScope))
                continue;
            foreach (var subject in schedule.Subjects) {
                if (!hitsByElementId.TryGetValue(subject.SubjectId, out var hits)) {
                    hits = [];
                    hitsByElementId[subject.SubjectId] = hits;
                }
                hits.Add(hit);
            }
        }

        var entries = elements
            .Select(item => new ScheduleCoverageElementEntry(
                item.Handle,
                hitsByElementId.TryGetValue(item.Handle.ElementId, out var hits)
                    ? hits.DistinctBy(hit => hit.ScheduleId).ToList()
                    : []
            ))
            .ToList();
        var covered = entries.Count(entry => entry.MatchingSchedules.Count != 0);
        AddScheduleRoleScopeDiagnostics(request.ScheduleRoleScope, catalog.Entries.Count, scheduleNames.Count, entries.Count, covered, issues);
        var projectedEntries = includeSamples
            ? entries.Where(entry => entry.MatchingSchedules.Count == 0).Concat(entries.Where(entry => entry.MatchingSchedules.Count != 0))
            : [];
        if (sampleLimit is > 0)
            projectedEntries = projectedEntries.Take(sampleLimit.Value);
        if (maxElements is > 0)
            projectedEntries = projectedEntries.Take(maxElements.Value);
        var returned = projectedEntries.ToList();
        var truncated = returned.Count < entries.Count && includeSamples;
        if (truncated) {
            issues.Add(new RevitDataIssue(
                "ScheduleCoverageTruncated",
                RevitDataIssueSeverity.Warning,
                $"Returned {returned.Count} of {entries.Count} schedule coverage element sample(s). Increase budget.maxEntries or budget.maxSamplesPerEntry to expand."
            ));
        }

        return new ScheduleCoverageData(
            entries.Count,
            covered,
            entries.Count - covered,
            scheduleNames.Count,
            returned,
            RevitDataOutputBudgets.ProjectIssues(issues, budget),
            new RevitDataResultPage(entries.Count, returned.Count, truncated)
        );
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
