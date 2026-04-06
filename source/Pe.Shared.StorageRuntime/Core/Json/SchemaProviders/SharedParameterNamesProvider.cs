using Pe.Shared.RevitData.Families;
using Pe.Shared.StorageRuntime.Capabilities;
using Pe.Shared.StorageRuntime.Json.FieldOptions;
using Pe.Shared.StorageRuntime.Json.SchemaProviders;

namespace Pe.Shared.StorageRuntime.Revit.Core.Json.SchemaProviders;

/// <summary>
///     Provides shared parameter names from the APS cache.
/// </summary>
public class SharedParameterNamesProvider : IFieldOptionsSource {
    public FieldOptionsDescriptor Describe() => new(
        nameof(SharedParameterNamesProvider),
        SettingsOptionsResolverKind.Remote,
        SettingsOptionsMode.Suggestion,
        true,
        [new FieldOptionsDependency(OptionContextKeys.SelectedFamilyNames, SettingsOptionsDependencyScope.Context)],
        SettingsRuntimeMode.LiveDocument
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
            var selectedFamilyNames = ParseDelimitedFamilyNames(rawFamilyNames);
            if (selectedFamilyNames.Count != 0) {
                var doc = context.GetActiveDocument();
                if (doc != null) {
                    var familyParameterNames = ProjectParameterCatalogCollector.Collect(doc, selectedFamilyNames)
                        .Select(item => item.Identity.Name)
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

    private static HashSet<string> ParseDelimitedFamilyNames(string rawNames) =>
        rawNames
            .Trim()
            .Trim('[', ']')
            .Split([',', ';', '|'], StringSplitOptions.RemoveEmptyEntries)
            .Select(name => name.Trim().Trim('"'))
            .Where(name => !string.IsNullOrWhiteSpace(name))
            .ToHashSet(StringComparer.OrdinalIgnoreCase);
}
