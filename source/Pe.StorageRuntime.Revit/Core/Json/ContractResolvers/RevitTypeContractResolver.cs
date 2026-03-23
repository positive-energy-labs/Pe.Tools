using Pe.StorageRuntime.Json;
using Pe.StorageRuntime.Json.ContractResolvers;

namespace Pe.StorageRuntime.Revit.Core.Json.ContractResolvers;

public class RevitTypeContractResolver : RegisteredTypeContractResolver {
    public RevitTypeContractResolver()
        : base(EnsureRegistryInitialized()) {
    }

    private static JsonTypeSchemaBindingRegistry EnsureRegistryInitialized() {
        RevitTypeRegistry.Initialize();
        return JsonTypeSchemaBindingRegistry.Shared;
    }
}
