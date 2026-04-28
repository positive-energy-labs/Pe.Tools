using Pe.Shared.RevitData.Schedules;

namespace Pe.Revit.DocumentData.Schedules.Collect;

internal static class ScheduleRenderedSubjectCollector {
    public static List<Element> CollectVisibleSubjects(
        Document doc,
        ViewSchedule schedule
    ) {
        if (schedule.IsTemplate)
            return [];

        return new FilteredElementCollector(doc, schedule.Id)
            .WhereElementIsNotElementType()
            .ToElements()
            .Where(ShouldInclude)
            .ToList();
    }

    public static List<ScheduleRenderedSubject> CollectSubjects(
        IReadOnlyList<Element> elements
    ) => elements
        .Select(ToSubject)
        .OrderBy(subject => subject.CategoryName ?? string.Empty, StringComparer.OrdinalIgnoreCase)
        .ThenBy(subject => subject.DisplayName, StringComparer.OrdinalIgnoreCase)
        .ThenBy(subject => subject.SubjectId)
        .ToList();

    private static bool ShouldInclude(Element element) =>
        element.Category != null &&
        !string.IsNullOrWhiteSpace(element.UniqueId);

    private static ScheduleRenderedSubject ToSubject(Element element) {
        var familyInstance = element as FamilyInstance;
        var family = familyInstance?.Symbol?.Family;
        var familyTypeName = familyInstance?.Symbol?.Name;
        var familyName = family?.Name;

        return new ScheduleRenderedSubject(
            element.Id.Value(),
            element.UniqueId,
            familyInstance == null ? element.GetType().Name : nameof(FamilyInstance),
            element.Category?.Name,
            GetDisplayName(element),
            family?.Id.Value(),
            familyName,
            familyTypeName
        );
    }

    private static string GetDisplayName(Element element) {
        if (element is FamilyInstance familyInstance) {
            var familyName = familyInstance.Symbol?.Family?.Name;
            var familyTypeName = familyInstance.Symbol?.Name;
            if (!string.IsNullOrWhiteSpace(familyName) && !string.IsNullOrWhiteSpace(familyTypeName))
                return $"{familyName} : {familyTypeName}";

            if (!string.IsNullOrWhiteSpace(familyName))
                return familyName;
        }

        return element.Name;
    }
}
