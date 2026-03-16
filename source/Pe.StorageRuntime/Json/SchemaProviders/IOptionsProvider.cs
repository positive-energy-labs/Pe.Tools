using Pe.StorageRuntime.Json.SchemaProviders;

namespace Pe.StorageRuntime.Json.SchemaProviders;

public interface IOptionsProvider {
    IEnumerable<string> GetExamples(SettingsProviderContext context);
}
