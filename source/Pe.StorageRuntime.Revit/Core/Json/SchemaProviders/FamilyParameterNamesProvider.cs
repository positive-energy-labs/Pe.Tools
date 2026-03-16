using Pe.StorageRuntime.Capabilities;
using Pe.StorageRuntime.Json.FieldOptions;
using Pe.StorageRuntime.Json.SchemaProviders;

namespace Pe.StorageRuntime.Revit.Core.Json.SchemaProviders;

public class FamilyParameterNamesProvider : IFieldOptionsSource {
    public FieldOptionsDescriptor Describe() => new(
        nameof(FamilyParameterNamesProvider),
        SettingsOptionsResolverKind.Dataset,
        SettingsOptionsDatasetKind.ParameterCatalog,
        SettingsOptionsMode.Suggestion,
        true,
        [new FieldOptionsDependency(OptionContextKeys.SelectedFamilyNames, SettingsOptionsDependencyScope.Context)],
        SettingsRuntimeCapabilityProfiles.LiveDocument
    );

    public ValueTask<IReadOnlyList<FieldOptionItem>> GetOptionsAsync(
        FieldOptionsExecutionContext context,
        CancellationToken cancellationToken = default
    ) {
        var selectedFamilyNames = context.TryGetContextValue(OptionContextKeys.SelectedFamilyNames, out var rawNames)
            ? ProjectFamilyParameterCollector.ParseDelimitedFamilyNames(rawNames)
            : [];
        var doc = context.GetActiveDocument();
        if (doc == null)
            return ValueTask.FromResult<IReadOnlyList<FieldOptionItem>>([]);

        var items = ProjectFamilyParameterCollector.Collect(doc, selectedFamilyNames)
            .Select(item => item.Name)
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .OrderBy(name => name, StringComparer.OrdinalIgnoreCase);
        return ValueTask.FromResult<IReadOnlyList<FieldOptionItem>>(
            items.Select(value => new FieldOptionItem(value, value, null)).ToList()
        );
    }
}
