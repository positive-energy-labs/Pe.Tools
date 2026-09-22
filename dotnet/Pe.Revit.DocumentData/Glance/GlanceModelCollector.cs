using Pe.Revit.DocumentData.AgentContext;
using Pe.Revit.DocumentData.Families.Loaded.Collectors;
using Pe.Shared.RevitData;

namespace Pe.Revit.DocumentData.Glance;

/// <summary>
///     One bounded "what IS this model" packet: document identity, true project
///     totals, levels, sheet-number series, family composition, and binding health.
///     Everything here is a complete-by-construction summary — no row budgets, no
///     truncation dialects — so the packet needs no page envelope, only Issues.
/// </summary>
public static class GlanceModelCollector {
    public static GlanceModelData Collect(Document document, RevitDocumentSummary documentSummary) {
        var issues = new List<RevitDataIssue>();

        var levels = new FilteredElementCollector(document)
            .OfClass(typeof(Level))
            .Cast<Level>()
            .OrderBy(level => level.Elevation)
            .Select(level => new GlanceLevelEntry(level.Name, level.Elevation))
            .ToList();

        var sheetSeries = new FilteredElementCollector(document)
            .OfClass(typeof(ViewSheet))
            .Cast<ViewSheet>()
            .Where(sheet => !sheet.IsTemplate)
            .Select(sheet => sheet.SheetNumber?.Trim())
            .Where(number => !string.IsNullOrEmpty(number) && char.IsLetter(number![0]))
            .GroupBy(number => char.ToUpperInvariant(number![0]).ToString(), StringComparer.Ordinal)
            .Select(group => new GlanceSheetSeriesEntry(group.Key, group.Count()))
            .OrderByDescending(entry => entry.SheetCount)
            .ThenBy(entry => entry.Prefix, StringComparer.Ordinal)
            .ToList();

        var familyRecords = LoadedFamiliesCatalogCollector.CollectCanonical(document);
        var familySummary = new LoadedFamiliesCatalogSummary(
            familyRecords.Count,
            familyRecords.Count(family => family.PlacedInstanceCount > 0),
            familyRecords.Count(family => family.PlacedInstanceCount == 0),
            familyRecords.Sum(family => family.Types.Count),
            familyRecords.Sum(family => family.PlacedInstanceCount),
            Truncated: false
        );
        var familiesByCategory = familyRecords
            .GroupBy(
                family => string.IsNullOrWhiteSpace(family.CategoryName) ? "(uncategorized)" : family.CategoryName!,
                StringComparer.OrdinalIgnoreCase
            )
            .Select(group => new GlanceCategoryFamilyCount(group.Key, group.Count()))
            .OrderByDescending(entry => entry.FamilyCount)
            .ThenBy(entry => entry.CategoryName, StringComparer.OrdinalIgnoreCase)
            .ToList();

        // Entries budget 1: the glance only wants the (pre-truncation, complete) summary.
        var bindings = ProjectParameterBindingsCollector.Collect(
            document,
            budget: new RevitDataOutputBudget { MaxEntries = 1 }
        );
        issues.AddRange(bindings.Issues.Where(issue => issue.Code != "ProjectParameterBindingsTruncated"));

        return new GlanceModelData(
            DateTime.UtcNow.ToString("o"),
            documentSummary,
            RevitAgentContextCollector.CreateBrowserSummary(document),
            levels,
            sheetSeries,
            familySummary,
            familiesByCategory,
            bindings.Summary with { Truncated = false },
            issues
        );
    }
}
