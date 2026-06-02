namespace Pe.Shared.Product;

public sealed record ProductRuntimeResolution(
    ProductRuntimeLane RuntimeLane,
    string HostExecutablePath,
    string HostDllPath,
    string PeaLauncherPath,
    string? DescriptorPath,
    string Source
);

public static class ProductRuntimeAuthority {
    public static ProductRuntimeResolution ResolveForCurrentMachine(
        ProductRuntimeLane runtimeLane,
        string? localAppData = null,
        string? descriptorPath = null,
        string? source = null
    ) {
        var installedRuntime = ProductRuntimeLayout.ForCurrentUser(localAppData);
        var developmentRuntime = ProductDevelopmentRuntimeLayout.ForCurrentUser(localAppData);

        var hostExecutablePath = runtimeLane == ProductRuntimeLane.Dev
            ? developmentRuntime.Binaries.HostExecutablePath
            : installedRuntime.Binaries.HostExecutablePath;
        var hostDllPath = runtimeLane == ProductRuntimeLane.Dev
            ? developmentRuntime.Binaries.HostDllPath
            : installedRuntime.Binaries.HostDllPath;

        return new ProductRuntimeResolution(
            runtimeLane,
            hostExecutablePath,
            hostDllPath,
            installedRuntime.Binaries.PeaLauncherPath,
            descriptorPath,
            source ?? "explicit"
        );
    }

    public static ProductRuntimeResolution ResolveForExecutingPeAppAssembly(string executingAssemblyPath) {
        var descriptorPath = RevitDeploymentIdentity.ResolveRuntimeDescriptorPathForAssembly(executingAssemblyPath);
        if (PeAppRuntimeDeploymentDescriptor.TryLoad(descriptorPath, out var descriptor) && descriptor is not null) {
            return ResolveForCurrentMachine(
                descriptor.RuntimeLane,
                descriptorPath: descriptorPath,
                source: "runtime-descriptor"
            );
        }

        return ResolveForCurrentMachine(
            ProductRuntimeLane.Installed,
            descriptorPath: descriptorPath,
            source: File.Exists(descriptorPath) ? "invalid-runtime-descriptor-default" : "missing-runtime-descriptor-default"
        );
    }
}
