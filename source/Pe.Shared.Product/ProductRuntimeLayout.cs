namespace Pe.Shared.Product;

/// <summary>
///     The per-user product root and the mutable state/log/cache trees the product owns underneath
///     it. Installed BINARY paths are deliberately absent: <c>product.payloads.json</c> is the
///     single authority for the installed layout, and the SDK's InstalledProduct reads it. Nothing
///     here restates payload names, executable names, or bin/shim directories.
/// </summary>
public sealed record ProductRuntimeLayout(
    string RootPath,
    ProductRuntimeStateLayout State,
    ProductRuntimeLogLayout Logs,
    ProductRuntimeCacheLayout Cache
) {
    public static ProductRuntimeLayout ForCurrentUser(string? localAppData = null) {
        var rootPath = Path.Combine(
            ProductPathing.ResolveLocalAppData(localAppData),
            ProductIdentity.VendorName,
            ProductIdentity.ProductName
        );
        return new ProductRuntimeLayout(
            rootPath,
            new ProductRuntimeStateLayout(Path.Combine(rootPath, ProductPathNames.StateDirectoryName)),
            new ProductRuntimeLogLayout(Path.Combine(rootPath, ProductPathNames.LogsDirectoryName)),
            new ProductRuntimeCacheLayout(Path.Combine(rootPath, ProductPathNames.CacheDirectoryName))
        );
    }
}

public sealed record ProductRuntimeStateLayout(string RootPath) {
    public string GlobalStatePath => Path.Combine(this.RootPath, ProductPathNames.GlobalDirectoryName);
    public string ApsAuthStatePath => Path.Combine(this.RootPath, "aps-auth");
    public string ApsTokenStorePath => Path.Combine(this.ApsAuthStatePath, "tokens.json");
    public string ApsCredentialsPath => Path.Combine(this.ApsAuthStatePath, "credentials.json");

    public string ResolveModuleStatePath(string module) =>
        ProductPathing.ResolveSafeSubDirectoryPath(this.RootPath, module, nameof(module));
}

public sealed record ProductRuntimeLogLayout(string RootPath) {
    public string HostLogPath => Path.Combine(this.RootPath, ProductPathNames.HostLogFileName);
    public string RevitAppLogPath => Path.Combine(this.RootPath, ProductPathNames.RevitAppLogFileName);
}

public sealed record ProductRuntimeCacheLayout(string RootPath) {
    public string ResolveModuleCachePath(string module) =>
        ProductPathing.ResolveSafeSubDirectoryPath(this.RootPath, module, nameof(module));
}
