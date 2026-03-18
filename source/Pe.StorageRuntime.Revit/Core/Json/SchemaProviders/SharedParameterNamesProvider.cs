using Pe.StorageRuntime.Capabilities;
using Pe.StorageRuntime.Json.FieldOptions;
using Pe.StorageRuntime.Json.SchemaProviders;

namespace Pe.StorageRuntime.Revit.Core.Json.SchemaProviders;

/// <summary>
///     Provides shared parameter names from the APS cache.
/// </summary>
public class SharedParameterNamesProvider : IFieldOptionsSource {
    public FieldOptionsDescriptor Describe() => new(
        nameof(SharedParameterNamesProvider),
        SettingsOptionsResolverKind.Remote,
        null,
        SettingsOptionsMode.Suggestion,
        true,
        [new FieldOptionsDependency(OptionContextKeys.SelectedFamilyNames, SettingsOptionsDependencyScope.Context)],
        SettingsRuntimeCapabilityProfiles.LiveDocument
    );

    public ValueTask<IReadOnlyList<FieldOptionItem>> GetOptionsAsync(
        FieldOptionsExecutionContext context,
        CancellationToken cancellationToken = default
    ) {
        var apsNames = ApsParameterCacheReader.ReadEntries()
            .Where(entry => !entry.IsArchived)
            .Select(entry => entry.Name)
            .Where(name => !string.IsNullOrWhiteSpace(name))
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .OrderBy(name => name, StringComparer.OrdinalIgnoreCase)
            .ToList();
        if (apsNames.Count == 0)
            return new ValueTask<IReadOnlyList<FieldOptionItem>>([]);

        IEnumerable<string> values = apsNames;

        if (context.TryGetContextValue(OptionContextKeys.SelectedFamilyNames, out var rawFamilyNames)) {
            var selectedFamilyNames = ProjectFamilyParameterCollector.ParseDelimitedFamilyNames(rawFamilyNames);
            if (selectedFamilyNames.Count != 0) {
                var doc = context.GetActiveDocument();
                if (doc != null) {
                    var familyParameterNames = ProjectFamilyParameterCollector.Collect(doc, selectedFamilyNames)
                        .Select(item => item.Name)
                        .ToHashSet(StringComparer.OrdinalIgnoreCase);
                    if (familyParameterNames.Count != 0) {
                        values = apsNames
                            .Where(familyParameterNames.Contains)
                            .Distinct(StringComparer.OrdinalIgnoreCase)
                            .OrderBy(name => name, StringComparer.OrdinalIgnoreCase);
                    }
                }
            }
        }

        return new ValueTask<IReadOnlyList<FieldOptionItem>>(
            values.Select(value => new FieldOptionItem(value, value, null)).ToList()
        );
    }
}
