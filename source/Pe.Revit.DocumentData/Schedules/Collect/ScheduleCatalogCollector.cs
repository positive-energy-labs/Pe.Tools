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
        var issues = new List<RevitDataIssue>();

        var entries = new FilteredElementCollector(doc)
            .OfClass(typeof(ViewSchedule))
            .Cast<ViewSchedule>()
            .Where(schedule => includeTemplates || !schedule.IsTemplate)
            .Where(schedule => !schedule.Name.Contains("<Revision Schedule>", StringComparison.OrdinalIgnoreCase))
            .Where(schedule => MatchesFilter(schedule, categoryNames, scheduleNames, customParameterFilters))
            .OrderBy(schedule => schedule.Name, StringComparer.OrdinalIgnoreCase)
            .Select(schedule => TryCollectEntry(doc, schedule, issues))
            .Where(entry => entry != null)
            .Cast<ScheduleCatalogEntry>()
            .ToList();

        return new ScheduleCatalogData(entries, issues);
    }

    private static ScheduleCatalogEntry? TryCollectEntry(
        Document doc,
        ViewSchedule schedule,
        List<RevitDataIssue> issues
    ) {
        try {
            var profile = ScheduleHelper.SerializeSchedule(schedule);
            var sheetPlacements = ScheduleCollectorSupport.CollectSheetPlacements(doc, schedule);
            var customParameters = ScheduleCollectorSupport.CollectCustomParameters(schedule);
            var visibleFamilyInstances = ScheduleVisibleFamilyCollector.CollectVisibleFamilyInstances(doc, schedule);
            var visibleFamilies = ScheduleVisibleFamilyCollector.CollectVisibleFamilies(visibleFamilyInstances);
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
                sheetPlacements,
                profile.Filters ?? [],
                ScheduleCollectorSupport.CollectParameterUsages(doc, schedule),
                customParameters,
                visibleBodyRowCount,
                visibleFamilies.Count,
                visibleInstanceCount,
                visibleFamilies
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

    private static bool MatchesFilter(
        ViewSchedule schedule,
        HashSet<string> categoryNames,
        HashSet<string> scheduleNames,
        IReadOnlyList<ScheduleCustomParameterFilter> customParameterFilters
    ) {
        if (scheduleNames.Count != 0 && !scheduleNames.Contains(schedule.Name))
            return false;

        if (!ScheduleCollectorSupport.MatchesCustomParameterFilters(schedule, customParameterFilters))
            return false;

        if (categoryNames.Count == 0)
            return true;

        var categoryName = ScheduleCollectorSupport.GetCategoryName(schedule.Document, schedule);
        return !string.IsNullOrWhiteSpace(categoryName) && categoryNames.Contains(categoryName);
    }
}
