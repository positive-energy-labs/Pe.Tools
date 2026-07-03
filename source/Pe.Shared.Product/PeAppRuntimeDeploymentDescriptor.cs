using Newtonsoft.Json;

namespace Pe.Shared.Product;

public sealed record PeAppRuntimeDeploymentDescriptor(
    int SchemaVersion,
    string ProductName,
    ProductRuntimeLane RuntimeLane,
    string? Configuration
) {
    public const int CurrentSchemaVersion = 1;

    public static PeAppRuntimeDeploymentDescriptor Create(ProductRuntimeLane runtimeLane, string? configuration) =>
        new(CurrentSchemaVersion, ProductIdentity.ProductName, runtimeLane, configuration);

    public static PeAppRuntimeDeploymentDescriptor Load(string descriptorPath) {
        var json = File.ReadAllText(descriptorPath);
        var descriptor = JsonConvert.DeserializeObject<PeAppRuntimeDeploymentDescriptor>(json)
                         ?? throw new InvalidOperationException(
                             $"Runtime deployment descriptor '{descriptorPath}' could not be deserialized."
                         );
        if (descriptor.SchemaVersion != CurrentSchemaVersion) {
            throw new InvalidOperationException(
                $"Runtime deployment descriptor '{descriptorPath}' has unsupported schema version {descriptor.SchemaVersion}."
            );
        }

        if (!string.Equals(descriptor.ProductName, ProductIdentity.ProductName, StringComparison.Ordinal)) {
            throw new InvalidOperationException(
                $"Runtime deployment descriptor '{descriptorPath}' is for product '{descriptor.ProductName}', not '{ProductIdentity.ProductName}'."
            );
        }

        return descriptor;
    }

    public static bool TryLoad(string descriptorPath, out PeAppRuntimeDeploymentDescriptor? descriptor) {
        try {
            if (!File.Exists(descriptorPath)) {
                descriptor = null;
                return false;
            }

            descriptor = Load(descriptorPath);
            return true;
        } catch {
            descriptor = null;
            return false;
        }
    }

}
