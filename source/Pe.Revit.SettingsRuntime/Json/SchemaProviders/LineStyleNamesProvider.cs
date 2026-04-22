using Pe.Revit.SettingsRuntime.Json.FieldOptions;
using Pe.Shared.StorageRuntime.Capabilities;

namespace Pe.Revit.SettingsRuntime.Json.SchemaProviders;

public sealed class LineStyleNamesProvider : IFieldOptionsSource {
    public FieldOptionsDescriptor Describe() => new(
        nameof(LineStyleNamesProvider),
        SettingsOptionsResolverKind.Remote,
        SettingsOptionsMode.Suggestion,
        true,
        [],
        SettingsRuntimeMode.LiveDocument
    );

    public ValueTask<IReadOnlyList<FieldOptionItem>> GetOptionsAsync(
        FieldOptionsExecutionContext context,
        CancellationToken cancellationToken = default
    ) {
        try {
            var doc = context.GetActiveDocument();
            if (doc == null || doc.IsFamilyDocument) {
                return new ValueTask<IReadOnlyList<FieldOptionItem>>(BuildDefaultItems());
            }

            var lineCategory = doc.Settings.Categories.get_Item(BuiltInCategory.OST_Lines);
            if (lineCategory == null)
                return new ValueTask<IReadOnlyList<FieldOptionItem>>(BuildDefaultItems(includeInvisible: false));

            var lineStyles = new List<string>();
            foreach (Category subCategory in lineCategory.SubCategories) {
                if (!string.IsNullOrWhiteSpace(subCategory.Name))
                    lineStyles.Add(subCategory.Name);
            }

            return new ValueTask<IReadOnlyList<FieldOptionItem>>(
                lineStyles
                    .OrderBy(name => name, StringComparer.OrdinalIgnoreCase)
                    .Select(value => new FieldOptionItem(value, value, null))
                    .ToList()
            );
        } catch {
            return new ValueTask<IReadOnlyList<FieldOptionItem>>(BuildDefaultItems());
        }
    }

    private static IReadOnlyList<FieldOptionItem> BuildDefaultItems(bool includeInvisible = true) {
        var defaults = includeInvisible
            ? new[] { "Thin Lines", "Medium Lines", "Wide Lines", "Heavy Line", "<Invisible lines>" }
            : new[] { "Thin Lines", "Medium Lines", "Wide Lines", "Heavy Line" };
        return defaults
            .Select(value => new FieldOptionItem(value, value, null))
            .ToList();
    }
}
