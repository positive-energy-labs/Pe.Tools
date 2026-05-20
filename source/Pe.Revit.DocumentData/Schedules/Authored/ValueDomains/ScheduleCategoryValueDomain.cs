using Pe.Revit.DocumentData.Parameters;

namespace Pe.Revit.DocumentData.Schedules.Authored.ValueDomains;

public static class ScheduleCategoryValueDomain {
    public static IReadOnlyList<string> GetOptions() =>
        RevitLabelCatalog.GetLabelToBuiltInCategoryMap()
            .Keys
            .OrderBy(value => value, StringComparer.OrdinalIgnoreCase)
            .ToList();

    public static BuiltInCategory ResolveBuiltInCategory(string? categoryName) {
        if (string.IsNullOrWhiteSpace(categoryName))
            throw new ArgumentException("Schedule profile CategoryName is required.", nameof(categoryName));

        if (RevitLabelCatalog.GetLabelToBuiltInCategoryMap().TryGetValue(categoryName, out var builtInCategory))
            return builtInCategory;

        if (Enum.TryParse<BuiltInCategory>(categoryName, true, out var parsed))
            return parsed;

        throw new ArgumentException(
            $"Schedule category '{categoryName}' is not a known Revit category label or BuiltInCategory value.",
            nameof(categoryName)
        );
    }

    public static ElementId ResolveCategoryId(Document doc, string? categoryName) {
        ArgumentNullException.ThrowIfNull(doc);

        var builtInCategory = ResolveBuiltInCategory(categoryName);
        var category = Category.GetCategory(doc, builtInCategory);
        if (category == null)
            throw new ArgumentException($"Schedule category '{categoryName}' is not available in this document.");

        return category.Id;
    }

    public static Category? TryFindCategoryByName(Document doc, string? categoryName) {
        if (doc == null || string.IsNullOrWhiteSpace(categoryName))
            return null;

        if (RevitLabelCatalog.GetLabelToBuiltInCategoryMap().TryGetValue(categoryName, out var builtInCategory))
            return Category.GetCategory(doc, builtInCategory);

        foreach (Category category in doc.Settings.Categories) {
            if (string.Equals(category.Name, categoryName, StringComparison.OrdinalIgnoreCase))
                return category;
        }

        return null;
    }
}
