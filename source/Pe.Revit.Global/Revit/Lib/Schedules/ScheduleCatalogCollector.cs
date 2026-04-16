using Autodesk.Revit.DB;
using Pe.Revit.Global.PolyFill;
using Pe.Shared.HostContracts.RevitData;

namespace Pe.Revit.Global.Revit.Lib.Schedules;

public static class ScheduleCatalogCollector {
    public static ScheduleCatalogData Collect(
        Document doc,
        ScheduleCatalogRequest? request = null
    ) {
        var categoryNames = ScheduleCollectorSupport.ToFilterSet(request?.CategoryNames);
        var scheduleNames = ScheduleCollectorSupport.ToFilterSet(request?.ScheduleNames);
        var includeTemplates = request?.IncludeTemplates ?? false;
        var issues = new List<RevitDataIssue>();

        var entries = new FilteredElementCollector(doc)
            .OfClass(typeof(ViewSchedule))
            .Cast<ViewSchedule>()
            .Where(schedule => includeTemplates || !schedule.IsTemplate)
            .Where(schedule => !schedule.Name.Contains("<Revision Schedule>", StringComparison.OrdinalIgnoreCase))
            .Where(schedule => MatchesFilter(schedule, categoryNames, scheduleNames))
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
            var spec = ScheduleHelper.SerializeSchedule(schedule);
            var sheetPlacements = ScheduleCollectorSupport.CollectSheetPlacements(doc, schedule);

            return new ScheduleCatalogEntry(
                schedule.Id.Value(),
                schedule.UniqueId,
                schedule.Name,
                ScheduleCollectorSupport.GetCategoryName(doc, schedule),
                schedule.IsTemplate,
                spec.ViewTemplateName,
                spec.IsItemized,
                spec.FilterBySheet,
                sheetPlacements.Count != 0,
                sheetPlacements,
                ScheduleCollectorSupport.CollectFieldParameterNames(spec),
                ScheduleCollectorSupport.ToContractFilters(spec.Filters),
                ScheduleCollectorSupport.CollectParameterUsages(doc, schedule),
                ScheduleCollectorSupport.CollectCustomParameters(schedule)
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
        HashSet<string> scheduleNames
    ) {
        if (scheduleNames.Count != 0 && !scheduleNames.Contains(schedule.Name))
            return false;

        if (categoryNames.Count == 0)
            return true;

        var categoryName = ScheduleCollectorSupport.GetCategoryName(schedule.Document, schedule);
        return !string.IsNullOrWhiteSpace(categoryName) && categoryNames.Contains(categoryName);
    }
}
