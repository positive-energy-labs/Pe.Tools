using Pe.Host.Contracts;

namespace Pe.Global.Services.Storage.Core.Json.SchemaProviders;

public class FamilyParameterNamesProvider : IDependentOptionsProvider, IFieldOptionsClientHintProvider {
    public IReadOnlyList<string> DependsOn => [OptionContextKeys.SelectedFamilyNames];
    public FieldOptionsResolverKind Resolver => FieldOptionsResolverKind.Dataset;
    public FieldOptionsDatasetKind? Dataset => FieldOptionsDatasetKind.ParameterCatalog;

    public IEnumerable<string> GetExamples() =>
        this.GetExamples(new Dictionary<string, string>());

    public IEnumerable<string> GetExamples(IReadOnlyDictionary<string, string> siblingValues) {
        var selectedFamilyNames = siblingValues.TryGetValue(OptionContextKeys.SelectedFamilyNames, out var rawFamilyNames)
            ? ProjectFamilyParameterCollector.ParseDelimitedFamilyNames(rawFamilyNames)
            : [];
        var doc = Document.DocumentManager.GetActiveDocument();
        if (doc == null) return [];

        return ProjectFamilyParameterCollector.Collect(doc, selectedFamilyNames)
            .Select(item => item.Name)
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .OrderBy(name => name, StringComparer.OrdinalIgnoreCase);
    }
}
