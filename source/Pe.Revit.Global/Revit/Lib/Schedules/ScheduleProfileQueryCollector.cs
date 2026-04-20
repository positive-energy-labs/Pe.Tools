using Pe.Revit.Global.Revit.Documents.Schedules;
using Pe.Shared.HostContracts.RevitData;

namespace Pe.Revit.Global.Revit.Lib.Schedules;

public static class ScheduleProfileQueryCollector {
    public static ScheduleProfilesQueryData Collect(
        Document doc,
        ScheduleProfilesQuery? query = null
    ) {
        var issues = new List<RevitDataIssue>();
        var resolution = ResolveQuery(doc, query, issues);
        var entries = resolution.Schedules
            .Select(schedule => TryCollectEntry(doc, schedule, issues))
            .Where(entry => entry != null)
            .Cast<ScheduleProfileQueryEntry>()
            .ToList();

        return new ScheduleProfilesQueryData(
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
        ScheduleProfilesQuery? query,
        List<RevitDataIssue> issues
    ) {
        var effectiveQuery = query ?? new ScheduleProfilesQuery();
        return effectiveQuery.Kind switch {
            ScheduleProfilesQueryKind.CurrentActiveView => ResolveCurrentActiveView(effectiveQuery.IncludeTemplates, issues),
            ScheduleProfilesQueryKind.ScheduleNames => ResolveScheduleNames(doc, effectiveQuery, issues),
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
                "ScheduleProfilesCurrentActiveViewUnavailable",
                "Active view is not a supported schedule view.",
                activeView?.GetType().Name
            ));
            return new QueryResolution(ScheduleProfilesQueryKind.CurrentActiveView, 1, []);
        }

        if (!includeTemplates && schedule.IsTemplate) {
            issues.Add(ScheduleCollectorSupport.Warning(
                "ScheduleProfilesCurrentActiveViewTemplateExcluded",
                "Active schedule view is a template and templates were excluded.",
                schedule.Name
            ));
            return new QueryResolution(ScheduleProfilesQueryKind.CurrentActiveView, 1, []);
        }

        return new QueryResolution(ScheduleProfilesQueryKind.CurrentActiveView, 1, [schedule]);
    }

    private static QueryResolution ResolveScheduleReferences(
        Document doc,
        ScheduleProfilesQuery query,
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
                    "ScheduleProfileReferenceIdNotFound",
                    $"Could not resolve schedule id {scheduleId}.",
                    scheduleId.ToString())) {
                continue;
            }
        }

        foreach (var scheduleUniqueId in scheduleUniqueIds) {
            var schedule = doc.GetElement(scheduleUniqueId) as ViewSchedule;
            if (!TryAddResolvedSchedule(schedules, seenIds, schedule, query.IncludeTemplates, issues,
                    "ScheduleProfileReferenceUniqueIdNotFound",
                    $"Could not resolve schedule unique id '{scheduleUniqueId}'.",
                    scheduleUniqueId)) {
                continue;
            }
        }

        return new QueryResolution(
            ScheduleProfilesQueryKind.ScheduleReferences,
            scheduleIds.Count + scheduleUniqueIds.Count,
            schedules
        );
    }

    private static QueryResolution ResolveScheduleNames(
        Document doc,
        ScheduleProfilesQuery query,
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
                    "ScheduleProfileReferenceNameNotFound",
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
            ScheduleProfilesQueryKind.ScheduleNames,
            requestedNames.Count,
            schedules
        );
    }

    private static ScheduleProfileQueryEntry? TryCollectEntry(
        Document doc,
        ViewSchedule schedule,
        List<RevitDataIssue> issues
    ) {
        try {
            var profile = schedule.CaptureScheduleProfile();
            return new ScheduleProfileQueryEntry(
                schedule.Id.Value(),
                schedule.UniqueId,
                schedule.Name,
                ScheduleCollectorSupport.GetCategoryName(doc, schedule),
                schedule.IsTemplate,
                ScheduleCollectorSupport.ToContractProfile(profile),
                ScheduleCollectorSupport.CollectParameterUsages(doc, schedule),
                ScheduleCollectorSupport.CollectCustomParameters(schedule)
            );
        } catch (Exception ex) {
            issues.Add(ScheduleCollectorSupport.Warning(
                "ScheduleProfileQuerySerializationFailed",
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
                "ScheduleProfileReferenceTemplateExcluded",
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
        ScheduleProfilesQueryKind QueryKind,
        int RequestedScheduleCount,
        List<ViewSchedule> Schedules
    );
}
