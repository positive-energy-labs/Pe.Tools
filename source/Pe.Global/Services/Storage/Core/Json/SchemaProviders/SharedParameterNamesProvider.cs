using Pe.Global.Services.Aps.Models;
using Pe.Global.Services.Storage.Core.Json.SchemaProcessors;

namespace Pe.Global.Services.Storage.Core.Json.SchemaProviders;

/// <summary>
///     Provides shared parameter names from the APS cache for JSON schema examples.
///     Used to enable LSP autocomplete for parameter name properties.
/// </summary>
public class SharedParameterNamesProvider : IOptionsProvider {
    private const string CacheFilename = "parameters-service-cache";

    public IEnumerable<string> GetExamples() {
        try {
            var cache = Storage.GlobalDir().StateJson<ParametersApi.Parameters>(CacheFilename)
                as JsonReader<ParametersApi.Parameters>;
            if (!File.Exists(cache.FilePath)) return [];
            return cache.Read().Results
                   ?.Where(p => !p.IsArchived)
                   .Select(p => p.Name ?? string.Empty)
                   ?? [];
        } catch {
            // Cache missing or invalid - no examples, no crash
            return [];
        }
    }
}