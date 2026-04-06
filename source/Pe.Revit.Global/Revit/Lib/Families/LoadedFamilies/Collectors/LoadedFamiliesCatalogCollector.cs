using Pe.Shared.HostContracts.RevitData;
using Pe.Revit.Global.Revit.Lib.Families.LoadedFamilies.Models;

namespace Pe.Revit.Global.Revit.Lib.Families.LoadedFamilies.Collectors;

public static class LoadedFamiliesCatalogCollector {
    public static List<CollectedLoadedFamilyRecord> CollectCanonical(
        Document doc,
        LoadedFamiliesFilter? filter = null
    ) {
        var placedInstanceCounts = GetPlacedInstanceCounts(doc);
        var families = new FilteredElementCollector(doc)
            .OfClass(typeof(Family))
            .Cast<Family>()
            .Where(family => !family.IsInPlace)
            .Where(family => !string.IsNullOrWhiteSpace(family.Name))
            .Select(family => new CollectedLoadedFamilyRecord {
                FamilyId = family.Id.Value(),
                FamilyUniqueId = family.UniqueId,
                FamilyName = family.Name,
                CategoryName = family.FamilyCategory?.Name,
                PlacedInstanceCount = placedInstanceCounts.TryGetValue(family.Id.Value(), out var count) ? count : 0,
                Types = GetFamilyTypes(family)
            })
            .OrderBy(family => family.FamilyName, StringComparer.OrdinalIgnoreCase)
            .ToList();

        return LoadedFamiliesCollectorSupport.ApplyFilter(families, filter).ToList();
    }

    public static LoadedFamiliesCatalogData Collect(
        Document doc,
        LoadedFamiliesFilter? filter = null
    ) {
        var families = CollectCanonical(doc, filter);
        return new LoadedFamiliesCatalogData(
            families.Select(ToCatalogEntry).ToList(),
            families.SelectMany(family => family.Issues)
                .Select(LoadedFamiliesCollectorSupport.ToContractIssue)
                .ToList()
        );
    }

    private static List<CollectedLoadedFamilyTypeRecord> GetFamilyTypes(Family family) {
        var symbolIds = family.GetFamilySymbolIds();
        if (symbolIds == null || symbolIds.Count == 0)
            return [];

        return symbolIds
            .Select(id => family.Document.GetElement(id) as FamilySymbol)
            .Where(symbol => symbol != null)
            .Select(symbol => new CollectedLoadedFamilyTypeRecord(symbol!.Name))
            .OrderBy(type => type.TypeName, StringComparer.Ordinal)
            .ToList();
    }

    private static Dictionary<long, int> GetPlacedInstanceCounts(Document doc) =>
        new FilteredElementCollector(doc)
            .OfClass(typeof(FamilyInstance))
            .Cast<FamilyInstance>()
            .Where(instance => instance.Symbol?.Family != null)
            .GroupBy(instance => instance.Symbol.Family.Id.Value())
            .ToDictionary(group => group.Key, group => group.Count());

    private static LoadedFamilyCatalogEntry ToCatalogEntry(CollectedLoadedFamilyRecord family) =>
        new(
            family.FamilyId,
            family.FamilyUniqueId,
            family.FamilyName,
            family.CategoryName,
            family.Types.Count,
            family.PlacedInstanceCount,
            family.Types.Select(type => new LoadedFamilyTypeEntry(type.TypeName)).ToList()
        );
}
