using Pe.StorageRuntime.Capabilities;
using Pe.StorageRuntime.Json.FieldOptions;

namespace Pe.StorageRuntime.Revit.Core.Json.SchemaProviders;

/// <summary>
///     Provides category names from BuiltInCategory enum for JSON schema examples.
///     Document-independent implementation using LabelUtils.GetLabelFor().
///     Used to enable LSP autocomplete for category name properties.
/// </summary>
public class CategoryNamesProvider : IFieldOptionsSource {
    public FieldOptionsDescriptor Describe() => new(
        nameof(CategoryNamesProvider),
        SettingsOptionsResolverKind.Remote,
        null,
        SettingsOptionsMode.Suggestion,
        true,
        [],
        SettingsRuntimeCapabilityProfiles.RevitAssemblyOnly
    );

    public ValueTask<IReadOnlyList<FieldOptionItem>> GetOptionsAsync(
        FieldOptionsExecutionContext context,
        CancellationToken cancellationToken = default
    ) => ValueTask.FromResult<IReadOnlyList<FieldOptionItem>>(
        GetLabelToBuiltInCategoryMap()
            .Keys
            .Select(value => new FieldOptionItem(value, value, null))
            .ToList()
    );

    public static Dictionary<string, BuiltInCategory> GetLabelToBuiltInCategoryMap() {
        var labelMap = new Dictionary<string, BuiltInCategory>(StringComparer.OrdinalIgnoreCase);

        foreach (BuiltInCategory bic in Enum.GetValues(typeof(BuiltInCategory))) {
            try {
                // Use LabelUtils to get user-visible name (document-independent)
                var label = LabelUtils.GetLabelFor(bic);
                if (!string.IsNullOrWhiteSpace(label)) {
                    // Use TryAdd to handle potential duplicates (keep first occurrence)
                    _ = labelMap.TryAdd(label, bic);
                }
            } catch {
                // Some BuiltInCategory values may not have valid labels
            }
        }

        return labelMap;
    }

    public static Dictionary<BuiltInCategory, string> GetBuiltInCategoryToLabelMap() =>
        GetLabelToBuiltInCategoryMap().ToDictionary(kvp => kvp.Value, kvp => kvp.Key);

    public static string GetLabelForBuiltInCategory(BuiltInCategory bic) {
        try {
            return LabelUtils.GetLabelFor(bic);
        } catch {
            return bic.ToString();
        }
    }
}
