namespace Pe.Shared.Product;

public sealed record ProductRuntimeLayout(
    string RootPath,
    ProductRuntimeBinaryLayout Binaries,
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
        var binRootPath = Path.Combine(rootPath, ProductPathNames.BinDirectoryName);
        var stateRootPath = Path.Combine(rootPath, ProductPathNames.StateDirectoryName);
        var logsRootPath = Path.Combine(rootPath, ProductPathNames.LogsDirectoryName);
        var cacheRootPath = Path.Combine(rootPath, ProductPathNames.CacheDirectoryName);

        return new ProductRuntimeLayout(
            rootPath,
            new ProductRuntimeBinaryLayout(
                binRootPath,
                Path.Combine(binRootPath, HostProcessIdentity.DirectoryName),
                Path.Combine(binRootPath, HostProcessIdentity.DirectoryName, HostProcessIdentity.ExecutableName),
                Path.Combine(binRootPath, PeaCliIdentity.DirectoryName),
                Path.Combine(binRootPath, PeaCliIdentity.DirectoryName, PeaCliIdentity.LauncherName)
            ),
            new ProductRuntimeStateLayout(stateRootPath),
            new ProductRuntimeLogLayout(logsRootPath),
            new ProductRuntimeCacheLayout(cacheRootPath)
        );
    }
}

/// <summary>
///     Stable per-user binary paths. The versioned-layout path math (host <c>current.txt</c> +
///     <c>versions/&lt;v&gt;</c> resolution, and the parallel pea versioned/packages helpers) was
///     removed in Phase 2 — <c>Pe.Revit.Loader.InstalledProduct</c> now owns installed-lane
///     resolution through the same grammar the installer wrote. What remains is the dev-lane surface:
///     <see cref="PeaDirectoryPath" />/<see cref="PeaLauncherPath" /> are where <c>pe-dev pea
///     link-dev</c> writes the source-linked launcher, and <see cref="HostExecutablePath" /> is the
///     stable host candidate.
/// </summary>
public sealed record ProductRuntimeBinaryLayout(
    string RootPath,
    string HostDirectoryPath,
    string HostExecutablePath,
    string PeaDirectoryPath,
    string PeaLauncherPath
);

public sealed record ProductRuntimeStateLayout(string RootPath) {
    public string GlobalStatePath => Path.Combine(this.RootPath, ProductPathNames.GlobalDirectoryName);
    public string ApsAuthStatePath => Path.Combine(this.RootPath, "aps-auth");
    public string ApsTokenStorePath => Path.Combine(this.ApsAuthStatePath, "tokens.json");

    public string ResolveModuleStatePath(string moduleKey) =>
        ProductPathing.ResolveSafeSubDirectoryPath(this.RootPath, moduleKey, nameof(moduleKey));
}

public sealed record ProductRuntimeLogLayout(string RootPath) {
    public string HostLogPath => Path.Combine(this.RootPath, ProductPathNames.HostLogFileName);
    public string RevitAppLogPath => Path.Combine(this.RootPath, ProductPathNames.RevitAppLogFileName);
}

public sealed record ProductRuntimeCacheLayout(string RootPath) {
    public string ResolveModuleCachePath(string moduleKey) =>
        ProductPathing.ResolveSafeSubDirectoryPath(this.RootPath, moduleKey, nameof(moduleKey));
}
