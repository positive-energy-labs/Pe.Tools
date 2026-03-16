using Pe.StorageRuntime.Capabilities;
using Pe.StorageRuntime.Json.SchemaProviders;

namespace Pe.StorageRuntime.Revit.Core.Json.SchemaProviders;

/// <summary>
///     Provides schedule view template names from the active Revit document.
/// </summary>
[SettingsCapabilityTier(SettingsCapabilityTier.LiveRevitDocument)]
public class ScheduleViewTemplateNamesProvider : IOptionsProvider {
    public IEnumerable<string> GetExamples(SettingsProviderContext context) {
        try {
            var doc = context.GetActiveDocument();
            if (doc == null || doc.IsFamilyDocument)
                return [];

            return new FilteredElementCollector(doc)
                .OfClass(typeof(ViewSchedule))
                .Cast<ViewSchedule>()
                .Where(view => view.IsTemplate)
                .Select(view => view.Name)
                .Where(name => !string.IsNullOrWhiteSpace(name))
                .Distinct(StringComparer.OrdinalIgnoreCase)
                .OrderBy(name => name, StringComparer.OrdinalIgnoreCase);
        } catch {
            return [];
        }
    }
}
