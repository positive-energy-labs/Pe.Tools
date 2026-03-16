using Pe.StorageRuntime.Json.ContractResolvers;

namespace Pe.StorageRuntime.Revit.Core.Json.ContractResolvers;

public class RevitTypeContractResolver : RegisteredTypeContractResolver {
    public RevitTypeContractResolver()
        : base(RevitTypeRegistry.TryGet) {
    }
}
