using Pe.Revit.DocumentData.Families.Loaded.Models;
using Pe.Shared.RevitData;

namespace Pe.Revit.DocumentData.Families.Loaded.Collectors;

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
        LoadedFamiliesFilter? filter = null,
        RevitDataProjectionRequest? projection = null,
        RevitDataOutputBudget? budget = null
    ) {
        var effectiveBudget = RevitDataOutputBudgets.WithDefaults(budget, maxEntries: 50, maxSamplesPerEntry: 10);
        var allFamilies = CollectCanonical(doc);
        var families = LoadedFamiliesCollectorSupport.ApplyFilter(allFamilies, filter).ToList();
        var maxFamilies = effectiveBudget.MaxEntries;
        var truncated = maxFamilies is > 0 && families.Count > maxFamilies.Value;
        var returnedFamilies = truncated
            ? families.Take(maxFamilies!.Value).ToList()
            : families;
        var maxTypesPerFamily = effectiveBudget.MaxSamplesPerEntry;
        var includeTypes = projection?.View is RevitDataResultView.Rows or RevitDataResultView.Full
                          ;
        var issues = families.SelectMany(family => family.Issues)
            .Select(LoadedFamiliesCollectorSupport.ToContractIssue)
            .ToList();
        AddFilterDiagnostics(filter, allFamilies, families, issues);
        if (truncated) {
            issues.Add(new RevitDataIssue(
                "LoadedFamiliesCatalogTruncated",
                RevitDataIssueSeverity.Warning,
                $"Returned {returnedFamilies.Count} of {families.Count} matching loaded familie(s). Increase budget.maxEntries to expand."
            ));
        }

        return new LoadedFamiliesCatalogData(
            new LoadedFamiliesCatalogSummary(
                families.Count,
                families.Count(family => family.PlacedInstanceCount > 0),
                families.Count(family => family.PlacedInstanceCount == 0),
                families.Sum(family => family.Types.Count),
                families.Sum(family => family.PlacedInstanceCount),
                truncated
            ),
            returnedFamilies.Select(family => ToCatalogEntry(family, includeTypes, maxTypesPerFamily)).ToList(),
            RevitDataOutputBudgets.ProjectIssues(issues, effectiveBudget),
            new RevitDataResultPage(families.Count, returnedFamilies.Count, truncated)
        );
    }

    private static void AddFilterDiagnostics(
        LoadedFamiliesFilter? filter,
        IReadOnlyList<CollectedLoadedFamilyRecord> allFamilies,
        IReadOnlyList<CollectedLoadedFamilyRecord> families,
        List<RevitDataIssue> issues
    ) {
        if (filter == null || !HasFilter(filter) || families.Count != 0)
            return;

        issues.Add(new RevitDataIssue(
            "LoadedFamiliesFilterMatchedZeroFamilies",
            RevitDataIssueSeverity.Warning,
            $"Loaded-family filter matched zero families out of {allFamilies.Count}. Check family/category names, contains filters, or placementScope."
        ));
    }

    private static bool HasFilter(LoadedFamiliesFilter filter) =>
        filter.FamilyNames.Any(name => !string.IsNullOrWhiteSpace(name))
        || filter.CategoryNames.Any(name => !string.IsNullOrWhiteSpace(name))
        || !string.IsNullOrWhiteSpace(filter.FamilyNameContains)
        || !string.IsNullOrWhiteSpace(filter.CategoryNameContains)
        || filter.PlacementScope != LoadedFamilyPlacementScope.AllLoaded;

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

    private static LoadedFamilyCatalogEntry ToCatalogEntry(
        CollectedLoadedFamilyRecord family,
        bool includeTypes,
        int? maxTypesPerFamily
    ) {
        var types = includeTypes
            ? family.Types.AsEnumerable()
            : [];
        if (maxTypesPerFamily is > 0)
            types = types.Take(maxTypesPerFamily.Value);

        return new LoadedFamilyCatalogEntry(
            family.FamilyId,
            family.FamilyUniqueId,
            family.FamilyName,
            family.CategoryName,
            family.Types.Count,
            family.PlacedInstanceCount,
            types.Select(type => new LoadedFamilyTypeEntry(type.TypeName)).ToList()
        );
    }
}
