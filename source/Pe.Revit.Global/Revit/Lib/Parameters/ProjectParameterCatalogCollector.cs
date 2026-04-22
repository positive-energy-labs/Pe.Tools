using Pe.Revit.Global.Revit.Lib.Families.LoadedFamilies.Collectors;
using Pe.Shared.RevitData.Families;

namespace Pe.Revit.Global.Revit.Lib.Parameters;

public static class ProjectParameterCatalogCollector {
    public static IReadOnlyList<ProjectParameterCatalogEntry> Collect(
        Document doc,
        HashSet<string>? selectedFamilyNames = null,
        HashSet<long>? selectedFamilyIds = null
    ) {
        var collectedFamilies = ProjectLoadedFamilyCollector.Collect(doc, selectedFamilyNames, selectedFamilyIds);
        if (collectedFamilies.Count == 0)
            return [];

        var allTypeNames = collectedFamilies
            .SelectMany(family => family.Types)
            .Select(type => type.TypeName)
            .Where(name => !string.IsNullOrWhiteSpace(name))
            .Distinct(StringComparer.Ordinal)
            .OrderBy(name => name, StringComparer.Ordinal)
            .ToList();
        if (allTypeNames.Count == 0)
            return [];

        var flattened = new Dictionary<string, ProjectParameterCatalogEntry>(StringComparer.Ordinal);
        foreach (var family in collectedFamilies) {
            foreach (var parameter in family.Parameters) {
                var key = $"{parameter.Identity.Key}|{parameter.IsInstance}";
                if (!flattened.TryGetValue(key, out var collectedParameter)) {
                    collectedParameter = new ProjectParameterCatalogEntry {
                        Identity = parameter.Identity,
                        IsInstance = parameter.IsInstance,
                        PropertiesGroupKey = parameter.PropertiesGroupKey,
                        DataTypeKey = parameter.DataTypeKey,
                        StorageType = parameter.StorageType,
                        ValuesPerType = allTypeNames.ToDictionary(
                            typeName => typeName,
                            _ => (string?)null,
                            StringComparer.Ordinal
                        )
                    };
                    flattened[key] = collectedParameter;
                }

                _ = collectedParameter.FamilyNames.Add(family.FamilyName);
                foreach (var valueByType in parameter.ValuesByType)
                    collectedParameter.ValuesPerType[valueByType.Key] = valueByType.Value;
            }
        }

        return flattened.Values
            .OrderBy(parameter => parameter.Identity.Name, StringComparer.OrdinalIgnoreCase)
            .ThenByDescending(parameter => parameter.IsInstance)
            .ToList();
    }
}