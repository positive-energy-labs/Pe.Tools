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

        return new ProductDevelopmentRuntimeLayout(
            developmentRootPath,
            new ProductDevelopmentRuntimeBinaryLayout(
                developmentBinRootPath,
                Path.Combine(developmentBinRootPath, HostProcessIdentity.DirectoryName),
                Path.Combine(developmentBinRootPath, HostProcessIdentity.DirectoryName, HostProcessIdentity.ExecutableName)
            )
        );
    }

    public static string? ResolveSourceHostWorkingDirectory(string? sourceRoot) {
        if (sourceRoot is null) return null;
        var candidate = Path.Combine(sourceRoot, "source", "pe-tools");
        return File.Exists(Path.Combine(candidate, "apps", "host", "package.json")) ? candidate : null;
    }
}

public sealed record ProductDevelopmentRuntimeBinaryLayout(
    string RootPath,
    string HostDirectoryPath,
    string HostExecutablePath
);
