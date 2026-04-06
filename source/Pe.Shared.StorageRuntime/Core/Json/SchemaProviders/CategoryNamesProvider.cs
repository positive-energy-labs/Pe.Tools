using Pe.Shared.RevitData.Parameters;
using Pe.Shared.StorageRuntime.Capabilities;
using Pe.Shared.StorageRuntime.Json.FieldOptions;

namespace Pe.Shared.StorageRuntime.Revit.Core.Json.SchemaProviders;

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
        RevitTypeLabelCatalog.GetLabelToBuiltInCategoryMap()
            .Keys
            .Select(value => new FieldOptionItem(value, value, null))
            .ToList()
    );

    public static Dictionary<string, BuiltInCategory> GetLabelToBuiltInCategoryMap() =>
        RevitTypeLabelCatalog.GetLabelToBuiltInCategoryMap();

    public static Dictionary<BuiltInCategory, string> GetBuiltInCategoryToLabelMap() =>
        RevitTypeLabelCatalog.GetBuiltInCategoryToLabelMap();

    public static string GetLabelForBuiltInCategory(BuiltInCategory bic) =>
        RevitTypeLabelCatalog.GetLabelForBuiltInCategory(bic);
}
