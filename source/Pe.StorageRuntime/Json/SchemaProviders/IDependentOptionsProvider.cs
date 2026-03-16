using Pe.StorageRuntime.Json.SchemaProviders;

namespace Pe.StorageRuntime.Json.SchemaProviders;

public interface IDependentOptionsProvider : IOptionsProvider {
    IReadOnlyList<string> DependsOn { get; }
}
