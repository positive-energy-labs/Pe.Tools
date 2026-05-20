namespace Pe.Revit.DocumentData.Schedules.Authored.ValueDomains;

public static class ScheduleViewTemplateValueDomain {
    public static IReadOnlyList<string> GetOptions(Document? doc) {
        if (doc == null || doc.IsFamilyDocument)
            return [];

        return GetScheduleTemplateViews(doc)
            .Select(view => view.Name)
            .Where(name => !string.IsNullOrWhiteSpace(name))
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .OrderBy(name => name, StringComparer.OrdinalIgnoreCase)
            .ToList();
    }

    public static string? Serialize(ViewSchedule schedule) {
        var templateId = schedule.ViewTemplateId;
        if (templateId == ElementId.InvalidElementId)
            return null;

        var template = schedule.Document.GetElement(templateId) as View;
        return template?.Name;
    }

    public static ElementId Resolve(Document doc, string? templateName) {
        if (string.IsNullOrWhiteSpace(templateName))
            return ElementId.InvalidElementId;

        return GetScheduleTemplateViews(doc)
            .FirstOrDefault(view => view.Name.Equals(templateName, StringComparison.OrdinalIgnoreCase))
            ?.Id ?? ElementId.InvalidElementId;
    }

    public static (string? Applied, string? Skipped, string? Warning) ApplyTo(
        ViewSchedule schedule,
        string? templateName) {
        if (string.IsNullOrWhiteSpace(templateName))
            return (null, null, null);

        var templateId = Resolve(schedule.Document, templateName);
        if (templateId == ElementId.InvalidElementId) {
            return (null, $"View template '{templateName}' not found",
                $"View template '{templateName}' not found in document");
        }

        if (!schedule.IsValidViewTemplate(templateId)) {
            return (null, $"View template '{templateName}' is not valid for schedules",
                $"View template '{templateName}' is not compatible with this schedule");
        }

        try {
            schedule.ViewTemplateId = templateId;
            return (templateName, null, null);
        } catch (Exception ex) {
            return (null, $"Failed to apply: {ex.Message}",
                $"Failed to apply view template '{templateName}': {ex.Message}");
        }
    }

    private static IEnumerable<ViewSchedule> GetScheduleTemplateViews(Document doc) =>
        new FilteredElementCollector(doc)
            .OfClass(typeof(ViewSchedule))
            .Cast<ViewSchedule>()
            .Where(view => view.IsTemplate);
}
