using Pe.Shared.HostContracts.RevitData;

namespace Pe.Revit.Global.Revit.Lib.Schedules;

internal static class ScheduleVisibleFamilyCollector {
    public static List<ScheduleVisibleInstanceEntry> CollectVisibleInstances(
        Document doc,
        ViewSchedule schedule
    ) {
        if (schedule.IsTemplate)
            return [];

        return new FilteredElementCollector(doc, schedule.Id)
            .OfClass(typeof(FamilyInstance))
            .Cast<FamilyInstance>()
            .Select(instance => {
                var symbol = instance.Symbol;
                var family = symbol?.Family;
                return new ScheduleVisibleInstanceEntry(
                    instance.Id.Value(),
                    instance.UniqueId,
                    family?.Name ?? string.Empty,
                    symbol?.Name ?? string.Empty,
                    family?.FamilyCategory?.Name
                );
            })
            .OrderBy(entry => entry.FamilyName, StringComparer.OrdinalIgnoreCase)
            .ThenBy(entry => entry.FamilyTypeName, StringComparer.OrdinalIgnoreCase)
            .ThenBy(entry => entry.InstanceId)
            .ToList();
    }

    public static List<ScheduleVisibleFamilyEntry> CollectVisibleFamilies(
        Document doc,
        ViewSchedule schedule
    ) {
        if (schedule.IsTemplate)
            return [];

        return new FilteredElementCollector(doc, schedule.Id)
            .OfClass(typeof(FamilyInstance))
            .Cast<FamilyInstance>()
            .Select(instance => instance.Symbol?.Family)
            .Where(family => family != null)
            .Cast<Family>()
            .GroupBy(family => family.Id.Value())
            .Select(group => {
                var family = group.First();
                return new ScheduleVisibleFamilyEntry(
                    family.Id.Value(),
                    family.Name,
                    family.FamilyCategory?.Name,
                    group.Count()
                );
            })
            .OrderBy(entry => entry.FamilyName, StringComparer.OrdinalIgnoreCase)
            .ThenBy(entry => entry.CategoryName ?? string.Empty, StringComparer.OrdinalIgnoreCase)
            .ToList();
    }

    public static int GetVisibleBodyRowCount(ViewSchedule schedule) {
        if (schedule.IsTemplate)
            return 0;

        var bodySection = ScheduleCollectorSupport.SafeGet(() => schedule.GetTableData().GetSectionData(SectionType.Body));
        return bodySection?.NumberOfRows ?? 0;
    }
}
