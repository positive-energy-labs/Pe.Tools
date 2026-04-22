using Pe.Revit.SettingsRuntime.Json.FieldOptions;
using Pe.Shared.StorageRuntime.Capabilities;

namespace Pe.Revit.SettingsRuntime.Json.SchemaProviders;

/// <summary>
///     Provides category names from BuiltInCategory enum for JSON schema examples.
///     Document-independent implementation using LabelUtils.GetLabelFor().
///     Used to enable LSP autocomplete for category name properties.
/// </summary>
public class CategoryNamesProvider : IFieldOptionsSource {
    public FieldOptionsDescriptor Describe() => new(
        nameof(CategoryNamesProvider),
        SettingsOptionsResolverKind.Remote,
        SettingsOptionsMode.Suggestion,
        true,
        [],
        SettingsRuntimeMode.HostOnly
    );

    public ValueTask<IReadOnlyList<FieldOptionItem>> GetOptionsAsync(
        FieldOptionsExecutionContext context,
        CancellationToken cancellationToken = default
    ) => new(
        RevitLabelCatalog.GetLabelToBuiltInCategoryMap()
            .Keys
            .Select(value => new FieldOptionItem(value, value, null))
            .ToList()
    );

    public static Dictionary<string, BuiltInCategory> GetLabelToBuiltInCategoryMap() =>
        RevitLabelCatalog.GetLabelToBuiltInCategoryMap();

    public static Dictionary<BuiltInCategory, string> GetBuiltInCategoryToLabelMap() =>
        RevitLabelCatalog.GetBuiltInCategoryToLabelMap();

    public static string GetLabelForBuiltInCategory(BuiltInCategory bic) =>
        RevitLabelCatalog.GetLabelForBuiltInCategory(bic);

    public static Category? TryFindCategoryByName(Document doc, string? categoryName) {
        if (doc == null || string.IsNullOrWhiteSpace(categoryName))
            return null;

        if (GetLabelToBuiltInCategoryMap().TryGetValue(categoryName, out var builtInCategory))
            return Category.GetCategory(doc, builtInCategory);

        foreach (Category category in doc.Settings.Categories) {
            if (string.Equals(category.Name, categoryName, StringComparison.OrdinalIgnoreCase))
                return category;
        }

        return null;
    }
}

