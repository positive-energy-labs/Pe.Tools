using Pe.Global.Services.Aps.Models;
using Pe.Global.Services.Document;
using Pe.Global.Services.Storage.Core.Json.SchemaProcessors;

namespace Pe.Global.Services.Storage.Core.Json.SchemaProviders;

/// <summary>
///     Provides shared parameter names from the APS cache for JSON schema examples.
///     Used to enable LSP autocomplete for parameter name properties.
/// </summary>
public class SharedParameterNamesProvider : IDependentOptionsProvider {
    private const string CacheFilename = "parameters-service-cache";
    public IReadOnlyList<string> DependsOn => [OptionContextKeys.SelectedFamilyNames];

    public IEnumerable<string> GetExamples() {
        try {
            var cache = Storage.GlobalDir().StateJson<ParametersApi.Parameters>(CacheFilename)
                as JsonReader<ParametersApi.Parameters>;
            if (!File.Exists(cache.FilePath)) return [];
            return cache.Read().Results
                       ?.Where(p => !p.IsArchived)
                       .Select(p => p.Name ?? string.Empty)
                       .Where(name => !string.IsNullOrWhiteSpace(name))
                       .Distinct(StringComparer.OrdinalIgnoreCase)
                       .OrderBy(name => name)
                   ?? Enumerable.Empty<string>();
        } catch {
            // Cache missing or invalid - no examples, no crash
            return [];
        }
    }

    public IEnumerable<string> GetExamples(IReadOnlyDictionary<string, string> siblingValues) {
        var apsNames = this.GetExamples().ToList();
        if (apsNames.Count == 0) return [];

        if (!siblingValues.TryGetValue(OptionContextKeys.SelectedFamilyNames, out var rawFamilyNames))
            return apsNames;

        var selectedFamilyNames = ProjectFamilyParameterCollector.ParseDelimitedFamilyNames(rawFamilyNames);
        if (selectedFamilyNames.Count == 0) return apsNames;

        var doc = DocumentManager.GetActiveDocument();
        if (doc == null) return apsNames;

        var familyParameterNames = ProjectFamilyParameterCollector.Collect(doc, selectedFamilyNames)
            .Select(item => item.Name)
            .ToHashSet(StringComparer.OrdinalIgnoreCase);
        if (familyParameterNames.Count == 0) return apsNames;

        return apsNames
            .Where(familyParameterNames.Contains)
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .OrderBy(name => name);
    }
}