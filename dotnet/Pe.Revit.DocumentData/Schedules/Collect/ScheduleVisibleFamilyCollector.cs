using Pe.Shared.RevitData.Schedules;

namespace Pe.Revit.DocumentData.Schedules.Collect;

internal static class ScheduleVisibleFamilyCollector {
    public static List<FamilyInstance> CollectVisibleFamilyInstances(
        Document doc,
        ViewSchedule schedule
    ) {
        if (schedule.IsTemplate)
            return [];

        return new FilteredElementCollector(doc, schedule.Id)
            .OfClass(typeof(FamilyInstance))
            .Cast<FamilyInstance>()
            .OrderBy(instance => instance.Symbol?.Family?.Name ?? string.Empty, StringComparer.OrdinalIgnoreCase)
            .ThenBy(instance => instance.Symbol?.Name ?? string.Empty, StringComparer.OrdinalIgnoreCase)
            .ThenBy(instance => instance.Id.Value())
            .ToList();
    }

    public static List<ScheduleVisibleFamilyEntry> CollectVisibleFamilies(
        IReadOnlyList<FamilyInstance> instances
    ) => instances
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

    public static List<ScheduleVisibleFamilyEntry> CollectVisibleFamilies(
        Document doc,
        ViewSchedule schedule
    ) => CollectVisibleFamilies(CollectVisibleFamilyInstances(doc, schedule));

    public static int GetVisibleBodyRowCount(
        Document doc,
        ViewSchedule schedule
    ) {
        if (schedule.IsTemplate)
            return 0;

        var bodySection =
            ScheduleCollectorSupport.SafeGet(() => schedule.GetTableData().GetSectionData(SectionType.Body));
        if (bodySection == null)
            return 0;

        var rowCount = bodySection.NumberOfRows;
        if (rowCount == 0)
            return 0;

        var headers = new List<(int ColumnNumber, string HeaderText)>();
        var visibleColumnNumber = bodySection.FirstColumnNumber;
        for (var i = 0;
             i < schedule.Definition.GetFieldCount() && visibleColumnNumber <= bodySection.LastColumnNumber;
             i++) {
            var field = schedule.Definition.GetField(i);
            if (field.IsHidden)
                continue;

            headers.Add((
                visibleColumnNumber,
                ScheduleCollectorSupport.NullIfWhiteSpace(field.ColumnHeading) ?? field.GetName()
            ));
            visibleColumnNumber++;
        }

        if (headers.Count == 0)
            return rowCount;

        var firstRowIsHeaderLike = headers.All(header =>
            string.Equals(
                ScheduleCollectorSupport.NullIfWhiteSpace(
                    ScheduleCollectorSupport.SafeGet(() => schedule.GetCellText(
                        SectionType.Body,
                        bodySection.FirstRowNumber,
                        header.ColumnNumber
                    ))
                ) ?? string.Empty,
                header.HeaderText,
                StringComparison.Ordinal
            )
        );

        return firstRowIsHeaderLike ? Math.Max(0, rowCount - 1) : rowCount;
    }

    public static int GetVisibleBodyRowCount(ViewSchedule schedule) {
        if (schedule.IsTemplate)
            return 0;

        return GetVisibleBodyRowCount(schedule.Document, schedule);
    }
}
