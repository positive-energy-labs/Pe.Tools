using Pe.StorageRuntime.Capabilities;

namespace Pe.StorageRuntime.Revit.Core.Json.SchemaProviders;

/// <summary>
///     Provides family names from the active Revit document.
/// </summary>
[SettingsCapabilityTier(SettingsCapabilityTier.LiveRevitDocument)]
public class FamilyNamesProvider : IOptionsProvider {
    public IEnumerable<string> GetExamples(SettingsProviderContext context) {
        try {
            var doc = context.GetActiveDocument();
            if (doc == null)
                return [];

            return new FilteredElementCollector(doc)
                .OfClass(typeof(Family))
                .Cast<Family>()
                .Select(family => family.Name)
                .Where(name => !string.IsNullOrWhiteSpace(name))
                .Distinct(StringComparer.OrdinalIgnoreCase)
                .OrderBy(name => name, StringComparer.OrdinalIgnoreCase);
        } catch {
            return [];
        }
    }
}
