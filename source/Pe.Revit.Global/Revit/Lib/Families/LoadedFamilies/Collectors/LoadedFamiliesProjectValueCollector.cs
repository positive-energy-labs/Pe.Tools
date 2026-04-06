using Pe.Revit.Global.Revit.Lib.Families.LoadedFamilies.Models;
using Pe.Shared.RevitData.Families;

namespace Pe.Revit.Global.Revit.Lib.Families.LoadedFamilies.Collectors;

public static class LoadedFamiliesProjectValueCollector {
    public static List<CollectedLoadedFamilyRecord> Collect(
        Document doc,
        IReadOnlyList<CollectedLoadedFamilyRecord> catalogFamilies,
        Action<string, TimeSpan>? onFamilyCollected = null
    ) {
        if (catalogFamilies.Count == 0)
            return [];

        var selectedFamilyIds = catalogFamilies
            .Select(family => family.FamilyId)
            .ToHashSet();
        var collectedFamilies = ProjectLoadedFamilyCollector.Collect(
            doc,
            new HashSet<string>(StringComparer.OrdinalIgnoreCase),
            selectedFamilyIds,
            (familyRecord, elapsed) => onFamilyCollected?.Invoke(familyRecord.FamilyName, elapsed)
        );
        var mappedFamilies = collectedFamilies
            .Select(LoadedFamiliesCollectorSupport.MapProjectFamily)
            .OrderBy(family => family.FamilyName, StringComparer.OrdinalIgnoreCase)
            .ToList();

        return MergeCatalogMetadata(catalogFamilies, mappedFamilies);
    }

    internal static List<CollectedLoadedFamilyRecord> MergeCatalogMetadata(
        IReadOnlyList<CollectedLoadedFamilyRecord> catalogFamilies,
        IReadOnlyList<CollectedLoadedFamilyRecord> valueFamilies
    ) {
        var catalogById = catalogFamilies.ToDictionary(family => family.FamilyId);
        return valueFamilies
            .Select(family => {
                if (!catalogById.TryGetValue(family.FamilyId, out var catalogFamily))
                    return family;

                return family with {
                    FamilyUniqueId = catalogFamily.FamilyUniqueId,
                    FamilyName = catalogFamily.FamilyName,
                    CategoryName = catalogFamily.CategoryName,
                    PlacedInstanceCount = catalogFamily.PlacedInstanceCount,
                    Types = catalogFamily.Types,
                    Parameters = family.Parameters
                        .Select(parameter => parameter with {
                            FamilyId = catalogFamily.FamilyId,
                            FamilyUniqueId = catalogFamily.FamilyUniqueId,
                            FamilyName = catalogFamily.FamilyName,
                            CategoryName = catalogFamily.CategoryName
                        })
                        .ToList(),
                    Issues = catalogFamily.Issues.Concat(family.Issues).ToList()
                };
            })
            .OrderBy(family => family.FamilyName, StringComparer.OrdinalIgnoreCase)
            .ToList();
    }
}
