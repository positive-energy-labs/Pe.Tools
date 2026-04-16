using Autodesk.Revit.DB;
using Pe.Revit.Global.PolyFill;
using Pe.Revit.Global.Revit.Documents;
using Pe.Revit.Global.Services.Document;
using Pe.Shared.HostContracts.RevitData;

namespace Pe.Revit.Global.Revit.Lib.Schedules;

public static class ScheduleSpecQueryCollector {
    public static ScheduleSpecsQueryData Collect(
        Document doc,
        ScheduleSpecsQuery? query = null
    ) {
        var issues = new List<RevitDataIssue>();
        var resolution = ResolveQuery(doc, query, issues);
        var entries = resolution.Schedules
            .Select(schedule => TryCollectEntry(doc, schedule, issues))
            .Where(entry => entry != null)
            .Cast<ScheduleSpecQueryEntry>()
            .ToList();

        return new ScheduleSpecsQueryData(
            doc.Title,
            resolution.QueryKind,
            resolution.RequestedScheduleCount,
            entries.Count,
            entries,
            issues
        );
    }

    private static QueryResolution ResolveQuery(
        Document doc,
        ScheduleSpecsQuery? query,
        List<RevitDataIssue> issues
    ) {
        var effectiveQuery = query ?? new ScheduleSpecsQuery();
        return effectiveQuery.Kind switch {
            ScheduleSpecsQueryKind.CurrentActiveView => ResolveCurrentActiveView(effectiveQuery.IncludeTemplates, issues),
            ScheduleSpecsQueryKind.ScheduleNames => ResolveScheduleNames(doc, effectiveQuery, issues),
            _ => ResolveScheduleReferences(doc, effectiveQuery, issues)
        };
    }

    private static QueryResolution ResolveCurrentActiveView(
        bool includeTemplates,
        List<RevitDataIssue> issues
    ) {
        var activeView = RevitUiSession.CurrentUIApplication.GetActiveView();
        if (activeView is not ViewSchedule schedule || IsRevisionSchedule(schedule)) {
            issues.Add(ScheduleCollectorSupport.Warning(
                "ScheduleSpecsCurrentActiveViewUnavailable",
                "Active view is not a supported schedule view.",
                activeView?.GetType().Name
            ));
            return new QueryResolution(ScheduleSpecsQueryKind.CurrentActiveView, 1, []);
        }

        if (!includeTemplates && schedule.IsTemplate) {
            issues.Add(ScheduleCollectorSupport.Warning(
                "ScheduleSpecsCurrentActiveViewTemplateExcluded",
                "Active schedule view is a template and templates were excluded.",
                schedule.Name
            ));
            return new QueryResolution(ScheduleSpecsQueryKind.CurrentActiveView, 1, []);
        }

        return new QueryResolution(ScheduleSpecsQueryKind.CurrentActiveView, 1, [schedule]);
    }

    private static QueryResolution ResolveScheduleReferences(
        Document doc,
        ScheduleSpecsQuery query,
        List<RevitDataIssue> issues
    ) {
        var schedules = new List<ViewSchedule>();
        var seenIds = new HashSet<long>();
        var scheduleIds = (query.ScheduleIds ?? [])
            .Distinct()
            .ToList();
        var scheduleUniqueIds = (query.ScheduleUniqueIds ?? [])
            .Where(value => !string.IsNullOrWhiteSpace(value))
            .Select(value => value.Trim())
            .Distinct(StringComparer.Ordinal)
            .ToList();

        foreach (var scheduleId in scheduleIds) {
            var schedule = doc.GetElement(new ElementId(scheduleId)) as ViewSchedule;
            if (!TryAddResolvedSchedule(schedules, seenIds, schedule, query.IncludeTemplates, issues,
                    "ScheduleSpecReferenceIdNotFound",
                    $"Could not resolve schedule id {scheduleId}.",
                    scheduleId.ToString())) {
                continue;
            }
        }

        foreach (var scheduleUniqueId in scheduleUniqueIds) {
            var schedule = doc.GetElement(scheduleUniqueId) as ViewSchedule;
            if (!TryAddResolvedSchedule(schedules, seenIds, schedule, query.IncludeTemplates, issues,
                    "ScheduleSpecReferenceUniqueIdNotFound",
                    $"Could not resolve schedule unique id '{scheduleUniqueId}'.",
                    scheduleUniqueId)) {
                continue;
            }
        }

        return new QueryResolution(
            ScheduleSpecsQueryKind.ScheduleReferences,
            scheduleIds.Count + scheduleUniqueIds.Count,
            schedules
        );
    }

    private static QueryResolution ResolveScheduleNames(
        Document doc,
        ScheduleSpecsQuery query,
        List<RevitDataIssue> issues
    ) {
        var requestedNames = (query.ScheduleNames ?? [])
            .Where(value => !string.IsNullOrWhiteSpace(value))
            .Select(value => value.Trim())
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToList();
        var candidates = CollectQueryableSchedules(doc, query.IncludeTemplates);
        var schedules = new List<ViewSchedule>();
        var seenIds = new HashSet<long>();

        foreach (var scheduleName in requestedNames) {
            var matches = candidates
                .Where(schedule => string.Equals(schedule.Name, scheduleName, StringComparison.OrdinalIgnoreCase))
                .OrderBy(schedule => schedule.Name, StringComparer.OrdinalIgnoreCase)
                .ToList();

            if (matches.Count == 0) {
                issues.Add(ScheduleCollectorSupport.Warning(
                    "ScheduleSpecReferenceNameNotFound",
                    $"Could not resolve schedule name '{scheduleName}'.",
                    scheduleName
                ));
                continue;
            }

            foreach (var schedule in matches) {
                if (seenIds.Add(schedule.Id.Value()))
                    schedules.Add(schedule);
            }
        }

        return new QueryResolution(
            ScheduleSpecsQueryKind.ScheduleNames,
            requestedNames.Count,
            schedules
        );
    }

    private static ScheduleSpecQueryEntry? TryCollectEntry(
        Document doc,
        ViewSchedule schedule,
        List<RevitDataIssue> issues
    ) {
        try {
            var spec = ScheduleHelper.SerializeSchedule(schedule);
            return new ScheduleSpecQueryEntry(
                schedule.Id.Value(),
                schedule.UniqueId,
                schedule.Name,
                ScheduleCollectorSupport.GetCategoryName(doc, schedule),
                schedule.IsTemplate,
                ScheduleCollectorSupport.ToContractSpec(spec),
                ScheduleCollectorSupport.CollectParameterUsages(doc, schedule),
                ScheduleCollectorSupport.CollectCustomParameters(schedule)
            );
        } catch (Exception ex) {
            issues.Add(ScheduleCollectorSupport.Warning(
                "ScheduleSpecQuerySerializationFailed",
                ex.Message,
                schedule.Name
            ));
            return null;
        }
    }

    private static List<ViewSchedule> CollectQueryableSchedules(
        Document doc,
        bool includeTemplates
    ) => new FilteredElementCollector(doc)
        .OfClass(typeof(ViewSchedule))
        .Cast<ViewSchedule>()
        .Where(schedule => includeTemplates || !schedule.IsTemplate)
        .Where(schedule => !IsRevisionSchedule(schedule))
        .ToList();

    private static bool TryAddResolvedSchedule(
        List<ViewSchedule> schedules,
        HashSet<long> seenIds,
        ViewSchedule? schedule,
        bool includeTemplates,
        List<RevitDataIssue> issues,
        string notFoundCode,
        string notFoundMessage,
        string elementName
    ) {
        if (schedule == null || IsRevisionSchedule(schedule)) {
            issues.Add(ScheduleCollectorSupport.Warning(notFoundCode, notFoundMessage, elementName));
            return false;
        }

        if (!includeTemplates && schedule.IsTemplate) {
            issues.Add(ScheduleCollectorSupport.Warning(
                "ScheduleSpecReferenceTemplateExcluded",
                $"Schedule '{schedule.Name}' is a template and templates were excluded.",
                schedule.Name
            ));
            return false;
        }

        if (seenIds.Add(schedule.Id.Value()))
            schedules.Add(schedule);

        return true;
    }

    private static bool IsRevisionSchedule(ViewSchedule schedule) =>
        schedule.Name.Contains("<Revision Schedule>", StringComparison.OrdinalIgnoreCase);

    private sealed record QueryResolution(
        ScheduleSpecsQueryKind QueryKind,
        int RequestedScheduleCount,
        List<ViewSchedule> Schedules
    );
}
