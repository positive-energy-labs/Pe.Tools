using System.Reflection;

namespace Pe.Revit.DocumentData.Parameters;

public static class RevitLabelCatalog {
    private static readonly Lazy<Dictionary<string, BuiltInCategory>> CategoryLabelMap = new(BuildCategoryLabelMap);

    private static readonly Lazy<Dictionary<BuiltInCategory, string>> CategoryValueMap =
        new(() => CategoryLabelMap.Value.ToDictionary(kvp => kvp.Value, kvp => kvp.Key));

    private static readonly Lazy<Dictionary<string, ForgeTypeId>> SpecLabelMap = new(BuildSpecLabelMap);

    private static readonly Lazy<Dictionary<ForgeTypeId, string>> SpecValueMap =
        new(() => SpecLabelMap.Value.ToDictionary(kvp => kvp.Value, kvp => kvp.Key));

    private static readonly Lazy<Dictionary<string, ForgeTypeId>> PropertyGroupLabelMap =
        new(BuildPropertyGroupLabelMap);

    private static readonly Lazy<Dictionary<ForgeTypeId, string>> PropertyGroupValueMap =
        new(() => PropertyGroupLabelMap.Value.ToDictionary(kvp => kvp.Value, kvp => kvp.Key));

    public static Dictionary<string, BuiltInCategory> GetLabelToBuiltInCategoryMap() =>
        new(CategoryLabelMap.Value, CategoryLabelMap.Value.Comparer);

    public static Dictionary<BuiltInCategory, string> GetBuiltInCategoryToLabelMap() =>
        new(CategoryValueMap.Value);

    public static string GetLabelForBuiltInCategory(BuiltInCategory category) {
        if (CategoryValueMap.Value.TryGetValue(category, out var label))
            return label;

        try {
            return LabelUtils.GetLabelFor(category);
        } catch {
            return category.ToString();
        }
    }

    public static Dictionary<string, ForgeTypeId> GetLabelToSpecMap() =>
        new(SpecLabelMap.Value, SpecLabelMap.Value.Comparer);

    public static Dictionary<ForgeTypeId, string> GetSpecToLabelMap() =>
        new(SpecValueMap.Value);

    public static string GetLabelForSpec(ForgeTypeId spec) =>
        SpecValueMap.Value.TryGetValue(spec, out var label) ? label : spec.TypeId;

    public static Dictionary<string, ForgeTypeId> GetLabelToPropertyGroupMap() =>
        new(PropertyGroupLabelMap.Value, PropertyGroupLabelMap.Value.Comparer);

    public static Dictionary<ForgeTypeId, string> GetPropertyGroupToLabelMap() =>
        new(PropertyGroupValueMap.Value);

    public static string GetLabelForPropertyGroup(ForgeTypeId propertyGroup) =>
        PropertyGroupValueMap.Value.TryGetValue(propertyGroup, out var label) ? label : propertyGroup.TypeId;

    private static Dictionary<string, BuiltInCategory> BuildCategoryLabelMap() {
        var labelMap = new Dictionary<string, BuiltInCategory>(StringComparer.OrdinalIgnoreCase);

        foreach (BuiltInCategory category in Enum.GetValues(typeof(BuiltInCategory))) {
            try {
                var label = LabelUtils.GetLabelFor(category);
                if (!string.IsNullOrWhiteSpace(label) && !labelMap.ContainsKey(label))
                    labelMap[label] = category;
            } catch {
            }
        }

        return labelMap;
    }

    private static Dictionary<string, ForgeTypeId> BuildSpecLabelMap() {
        var labelMap = new Dictionary<string, ForgeTypeId>(StringComparer.OrdinalIgnoreCase);

        foreach (var spec in SpecUtils.GetAllSpecs()) {
            var label = FormatSpecWithDiscipline(spec);
            if (!labelMap.ContainsKey(label))
                labelMap[label] = spec;
        }

        return labelMap;
    }

    private static Dictionary<string, ForgeTypeId> BuildPropertyGroupLabelMap() {
        var labelMap = new Dictionary<string, ForgeTypeId>(StringComparer.OrdinalIgnoreCase);
        var properties = typeof(GroupTypeId).GetProperties(BindingFlags.Public | BindingFlags.Static);

        foreach (var property in properties) {
            if (property.PropertyType != typeof(ForgeTypeId))
                continue;

            if (property.GetValue(null) is not ForgeTypeId value)
                continue;

            var label = GetBestEffortLabel(value);
            if (!string.IsNullOrWhiteSpace(label) && !labelMap.ContainsKey(label))
                labelMap[label] = value;
        }

        return labelMap;
    }

    private static string FormatSpecWithDiscipline(ForgeTypeId spec) {
        var label = GetBestEffortLabel(spec);
        var discipline = GetParentheticDiscipline(spec);
        return $"{label}{discipline}";
    }

    private static string GetParentheticDiscipline(ForgeTypeId spec) {
        if (!UnitUtils.IsMeasurableSpec(spec))
            return string.Empty;

        var disciplineId = UnitUtils.GetDiscipline(spec);
        var disciplineLabel = LabelUtils.GetLabelForDiscipline(disciplineId);
        return !string.IsNullOrEmpty(disciplineLabel) ? $" ({disciplineLabel})" : string.Empty;
    }

    private static string GetBestEffortLabel(ForgeTypeId forgeTypeId) {
        if (string.IsNullOrWhiteSpace(forgeTypeId.TypeId))
            return string.Empty;

        try {
            return LabelUtils.GetLabelForSpec(forgeTypeId);
        } catch {
        }

        try {
            return LabelUtils.GetLabelForGroup(forgeTypeId);
        } catch {
        }

        return forgeTypeId.TypeId;
    }
}
