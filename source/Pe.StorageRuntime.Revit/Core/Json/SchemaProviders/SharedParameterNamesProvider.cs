using Pe.StorageRuntime.Capabilities;

namespace Pe.StorageRuntime.Revit.Core.Json.SchemaProviders;

/// <summary>
///     Provides shared parameter names from the APS cache.
/// </summary>
[SettingsCapabilityTier(SettingsCapabilityTier.LiveRevitDocument)]
public class SharedParameterNamesProvider : IDependentOptionsProvider {
    public IReadOnlyList<string> DependsOn => [OptionContextKeys.SelectedFamilyNames];

    public IEnumerable<string> GetExamples(SettingsProviderContext context) {
        var apsNames = ApsParameterCacheReader.ReadEntries()
            .Where(entry => !entry.IsArchived)
            .Select(entry => entry.Name)
            .Where(name => !string.IsNullOrWhiteSpace(name))
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .OrderBy(name => name, StringComparer.OrdinalIgnoreCase)
            .ToList();
        if (apsNames.Count == 0)
            return [];

        if (!context.TryGetContextValue(OptionContextKeys.SelectedFamilyNames, out var rawFamilyNames))
            return apsNames;

        var selectedFamilyNames = ProjectFamilyParameterCollector.ParseDelimitedFamilyNames(rawFamilyNames);
        if (selectedFamilyNames.Count == 0)
            return apsNames;

        var doc = context.GetActiveDocument();
        if (doc == null)
            return apsNames;

        var familyParameterNames = ProjectFamilyParameterCollector.Collect(doc, selectedFamilyNames)
            .Select(item => item.Name)
            .ToHashSet(StringComparer.OrdinalIgnoreCase);
        if (familyParameterNames.Count == 0)
            return apsNames;

        return apsNames
            .Where(familyParameterNames.Contains)
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .OrderBy(name => name, StringComparer.OrdinalIgnoreCase);
    }
}
