using Pe.StorageRuntime.Capabilities;
using Pe.StorageRuntime.Json.FieldOptions;

namespace Pe.StorageRuntime.Revit.Core.Json.SchemaProviders;

/// <summary>
///     Provides family names from the active Revit document.
/// </summary>
public class FamilyNamesProvider : IFieldOptionsSource {
    public FieldOptionsDescriptor Describe() => new(
        nameof(FamilyNamesProvider),
        SettingsOptionsResolverKind.Remote,
        null,
        SettingsOptionsMode.Suggestion,
        true,
        [],
        SettingsRuntimeCapabilityProfiles.LiveDocument
    );

    public ValueTask<IReadOnlyList<FieldOptionItem>> GetOptionsAsync(
        FieldOptionsExecutionContext context,
        CancellationToken cancellationToken = default
    ) {
        try {
            var doc = context.GetActiveDocument();
            if (doc == null)
                return ValueTask.FromResult<IReadOnlyList<FieldOptionItem>>([]);

            var items = new FilteredElementCollector(doc)
                .OfClass(typeof(Family))
                .Cast<Family>()
                .Select(family => family.Name)
                .Where(name => !string.IsNullOrWhiteSpace(name))
                .Distinct(StringComparer.OrdinalIgnoreCase)
                .OrderBy(name => name, StringComparer.OrdinalIgnoreCase)
                .Select(value => new FieldOptionItem(value, value, null))
                .ToList();
            return ValueTask.FromResult<IReadOnlyList<FieldOptionItem>>(items);
        } catch {
            return ValueTask.FromResult<IReadOnlyList<FieldOptionItem>>([]);
        }
    }
}
