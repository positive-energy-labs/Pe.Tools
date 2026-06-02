using Pe.Revit.DocumentData.Parameters;

namespace Pe.Revit.DocumentData.Schedules.Authored.ValueDomains;

public static class ScheduleFieldNameValueDomain {
    public static IReadOnlyList<string> GetOptions(Document? doc, string? categoryName) {
        if (doc == null || doc.IsFamilyDocument)
            return [];

        var schedules = new FilteredElementCollector(doc)
            .OfClass(typeof(ViewSchedule))
            .Cast<ViewSchedule>()
            .Where(schedule => !schedule.IsTemplate)
            .Where(schedule => !schedule.Name.Contains("<Revision Schedule>", StringComparison.OrdinalIgnoreCase));

        if (!string.IsNullOrWhiteSpace(categoryName)) {
            schedules = schedules.Where(schedule =>
                string.Equals(
                    Category.GetCategory(doc, schedule.Definition.CategoryId)?.Name,
                    categoryName,
                    StringComparison.OrdinalIgnoreCase
                ));
        }

        return schedules
            .SelectMany(schedule => GetFieldNames(schedule, doc))
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .OrderBy(name => name, StringComparer.OrdinalIgnoreCase)
            .ToList();
    }

    public static SchedulableField? ResolveSchedulableField(ScheduleDefinition def, Document doc, ParameterReference parameter) {
        var references = ParameterReferenceResolver.Resolve([parameter]);
        if (references.Count == 0)
            return null;

        foreach (var field in def.GetSchedulableFields()) {
            var identity = ParameterIdentityFactory.FromParameterId(doc, field.ParameterId, field.GetName(doc));
            if (ParameterReferenceResolver.Matches(identity, references))
                return field;
        }

        return null;
    }

    public static ElementId? ResolveParameterId(ScheduleDefinition def, Document doc, ParameterReference parameter) {
        var field = ResolveSchedulableField(def, doc, parameter);
        return field?.ParameterId;
    }

    public static ParameterReference SerializeParameter(Document doc, ElementId parameterId) {
        var name = SerializeParameterName(doc, parameterId);
        return ParameterReference.FromIdentity(ParameterIdentityFactory.FromParameterId(doc, parameterId, name));
    }

    public static string SerializeParameterName(Document doc, ElementId parameterId) {
        if (parameterId == null || parameterId == ElementId.InvalidElementId)
            return string.Empty;

        if (parameterId.Value() < 0) {
            var builtInParameter = (BuiltInParameter)parameterId.Value();
            return LabelUtils.GetLabelFor(builtInParameter);
        }

        var parameterElement = doc.GetElement(parameterId);
        return parameterElement?.Name ?? string.Empty;
    }

    private static IEnumerable<string> GetFieldNames(ViewSchedule schedule, Document doc) {
        try {
            return schedule.Definition
                .GetSchedulableFields()
                .Select(field => field.GetName(doc))
                .Where(name => !string.IsNullOrWhiteSpace(name))
                .Distinct(StringComparer.OrdinalIgnoreCase)
                .ToList();
        } catch {
            return [];
        }
    }
}
