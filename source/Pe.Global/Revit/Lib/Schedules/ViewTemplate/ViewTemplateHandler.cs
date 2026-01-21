namespace Pe.Global.Revit.Lib.Schedules.ViewTemplate;

/// <summary>
///     Static handler for serializing and applying view templates to schedules.
/// </summary>
public static class ViewTemplateHandler {
    /// <summary>
    ///     Gets the view template name from a schedule, or null if none is applied.
    /// </summary>
    public static string? SerializeViewTemplate(ViewSchedule schedule) {
        var templateId = schedule.ViewTemplateId;
        if (templateId == ElementId.InvalidElementId) return null;

        var template = schedule.Document.GetElement(templateId) as View;
        return template?.Name;
    }

    /// <summary>
    ///     Applies a view template to a schedule by name.
    ///     Returns (applied template name, skipped reason, warning).
    /// </summary>
    public static (string? Applied, string? Skipped, string? Warning) ApplyViewTemplate(
        ViewSchedule schedule,
        string? viewTemplateName) {
        if (string.IsNullOrWhiteSpace(viewTemplateName))
            return (null, null, null);

        var templateId = FindScheduleViewTemplateByName(schedule.Document, viewTemplateName);
        if (templateId == ElementId.InvalidElementId) {
            return (null, $"View template '{viewTemplateName}' not found",
                $"View template '{viewTemplateName}' not found in document");
        }

        if (!schedule.IsValidViewTemplate(templateId)) {
            return (null, $"View template '{viewTemplateName}' is not valid for schedules",
                $"View template '{viewTemplateName}' is not compatible with this schedule");
        }

        try {
            schedule.ViewTemplateId = templateId;
            return (viewTemplateName, null, null);
        } catch (Exception ex) {
            return (null, $"Failed to apply: {ex.Message}",
                $"Failed to apply view template '{viewTemplateName}': {ex.Message}");
        }
    }

    /// <summary>
    ///     Finds a schedule view template by name.
    /// </summary>
    public static ElementId FindScheduleViewTemplateByName(Document doc, string templateName) {
        var templates = new FilteredElementCollector(doc)
            .OfClass(typeof(ViewSchedule))
            .Cast<View>()
            .Where(v => v.IsTemplate && v.Name.Equals(templateName, StringComparison.OrdinalIgnoreCase))
            .ToList();

        return templates.Count > 0 ? templates[0].Id : ElementId.InvalidElementId;
    }

    /// <summary>
    ///     Gets all schedule view template names from the document.
    /// </summary>
    public static List<string> GetScheduleViewTemplateNames(Document doc) =>
        new FilteredElementCollector(doc)
            .OfClass(typeof(ViewSchedule))
            .Cast<View>()
            .Where(v => v.IsTemplate)
            .Select(v => v.Name)
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .OrderBy(name => name)
            .ToList();
}