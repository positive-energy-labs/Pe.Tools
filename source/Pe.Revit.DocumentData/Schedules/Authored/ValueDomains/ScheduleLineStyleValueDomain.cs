namespace Pe.Revit.DocumentData.Schedules.Authored.ValueDomains;

public static class ScheduleLineStyleValueDomain {
    private static readonly string[] DefaultNames = ["Thin Lines", "Medium Lines", "Wide Lines", "Heavy Line"];

    public static IReadOnlyList<string> GetOptions(Document? doc, bool includeInvisible = true) {
        if (doc == null || doc.IsFamilyDocument)
            return GetDefaultOptions(includeInvisible);

        try {
            var lineCategory = doc.Settings.Categories.get_Item(BuiltInCategory.OST_Lines);
            if (lineCategory == null)
                return GetDefaultOptions(includeInvisible: false);

            var lineStyles = new List<string>();
            foreach (Category subCategory in lineCategory.SubCategories) {
                if (!string.IsNullOrWhiteSpace(subCategory.Name))
                    lineStyles.Add(subCategory.Name);
            }

            return lineStyles
                .OrderBy(name => name, StringComparer.OrdinalIgnoreCase)
                .ToList();
        } catch {
            return GetDefaultOptions(includeInvisible);
        }
    }

    public static ElementId? Resolve(Document doc, string? lineStyleName) {
        if (string.IsNullOrWhiteSpace(lineStyleName))
            return null;

        var lineCategory = doc.Settings.Categories.get_Item(BuiltInCategory.OST_Lines);
        if (lineCategory == null)
            return null;

        foreach (Category subCategory in lineCategory.SubCategories) {
            if (!subCategory.Name.Equals(lineStyleName, StringComparison.OrdinalIgnoreCase))
                continue;

            return subCategory.GetGraphicsStyle(GraphicsStyleType.Projection)?.Id;
        }

        return null;
    }

    public static string? Serialize(Document doc, ElementId lineStyleId) {
        if (lineStyleId == ElementId.InvalidElementId)
            return null;

        var graphicsStyle = doc.GetElement(lineStyleId) as GraphicsStyle;
        return graphicsStyle?.GraphicsStyleCategory?.Name;
    }

    private static IReadOnlyList<string> GetDefaultOptions(bool includeInvisible) =>
        (includeInvisible ? DefaultNames.Concat(["<Invisible lines>"]) : DefaultNames)
        .ToList();
}
