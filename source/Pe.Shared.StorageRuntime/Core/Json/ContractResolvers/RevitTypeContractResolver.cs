using Pe.Shared.StorageRuntime.Json;
using Pe.Shared.StorageRuntime.Json.ContractResolvers;

namespace Pe.Shared.StorageRuntime.Revit.Core.Json.ContractResolvers;

public class RevitTypeContractResolver : RegisteredTypeContractResolver {
    public RevitTypeContractResolver()
        : base(EnsureRegistryInitialized()) {
    }

    private static JsonTypeSchemaBindingRegistry EnsureRegistryInitialized() {
        RevitJsonSchemaModuleInitializer.EnsureRegistered();
        return JsonTypeSchemaBindingRegistry.Shared;
    }
}
