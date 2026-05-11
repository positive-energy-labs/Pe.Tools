namespace Pe.Shared.Product;

public sealed record ProductDevelopmentRuntimeLayout(
    string RootPath,
    ProductDevelopmentRuntimeBinaryLayout Binaries
) {
    public static ProductDevelopmentRuntimeLayout ForCurrentUser(string? localAppData = null) {
        var productRootPath = Path.Combine(
            ProductPathing.ResolveLocalAppData(localAppData),
            ProductIdentity.VendorName,
            ProductIdentity.ProductName
        );
        var developmentRootPath = Path.Combine(productRootPath, ProductPathNames.DevelopmentDirectoryName);
        var developmentBinRootPath = Path.Combine(developmentRootPath, ProductPathNames.BinDirectoryName);
        var installedBinRootPath = Path.Combine(productRootPath, ProductPathNames.BinDirectoryName);

        return new ProductDevelopmentRuntimeLayout(
            developmentRootPath,
            new ProductDevelopmentRuntimeBinaryLayout(
                developmentBinRootPath,
                Path.Combine(developmentBinRootPath, HostProcessIdentity.DirectoryName),
                Path.Combine(developmentBinRootPath, HostProcessIdentity.DirectoryName, HostProcessIdentity.ExecutableName),
                Path.Combine(developmentBinRootPath, HostProcessIdentity.DirectoryName, HostProcessIdentity.DllName),
                Path.Combine(installedBinRootPath, PeDevCliIdentity.DirectoryName),
                Path.Combine(installedBinRootPath, PeDevCliIdentity.DirectoryName, PeDevCliIdentity.ExecutableName),
                Path.Combine(installedBinRootPath, PeDevCliIdentity.DirectoryName, PeDevCliIdentity.DllName)
            )
        );
    }
}

public sealed record ProductDevelopmentRuntimeBinaryLayout(
    string RootPath,
    string HostDirectoryPath,
    string HostExecutablePath,
    string HostDllPath,
    string PeDevDirectoryPath,
    string PeDevExecutablePath,
    string PeDevDllPath
);
