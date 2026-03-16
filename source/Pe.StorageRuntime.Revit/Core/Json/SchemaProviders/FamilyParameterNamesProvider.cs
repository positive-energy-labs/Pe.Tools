using Pe.StorageRuntime.Capabilities;

namespace Pe.StorageRuntime.Revit.Core.Json.SchemaProviders;

[SettingsCapabilityTier(SettingsCapabilityTier.LiveRevitDocument)]
public class FamilyParameterNamesProvider : IDependentOptionsProvider, IFieldOptionsClientHintProvider {
    public IReadOnlyList<string> DependsOn => [OptionContextKeys.SelectedFamilyNames];

    public IEnumerable<string> GetExamples(SettingsProviderContext context) {
        var selectedFamilyNames = context.TryGetContextValue(OptionContextKeys.SelectedFamilyNames, out var rawNames)
            ? ProjectFamilyParameterCollector.ParseDelimitedFamilyNames(rawNames)
            : [];
        var doc = context.GetActiveDocument();
        if (doc == null)
            return [];

        return ProjectFamilyParameterCollector.Collect(doc, selectedFamilyNames)
            .Select(item => item.Name)
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .OrderBy(name => name, StringComparer.OrdinalIgnoreCase);
    }

    public SettingsOptionsResolverKind Resolver => SettingsOptionsResolverKind.Dataset;
    public SettingsOptionsDatasetKind? Dataset => SettingsOptionsDatasetKind.ParameterCatalog;
}
