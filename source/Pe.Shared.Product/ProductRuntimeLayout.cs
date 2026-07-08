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
                Path.Combine(binRootPath, HostProcessIdentity.DirectoryName, PeaCliIdentity.CurrentVersionFileName),
                Path.Combine(binRootPath, HostProcessIdentity.DirectoryName, PeaCliIdentity.VersionsDirectoryName),
                Path.Combine(binRootPath, PeaCliIdentity.DirectoryName),
                Path.Combine(binRootPath, PeaCliIdentity.DirectoryName, PeaCliIdentity.LauncherName),
                Path.Combine(binRootPath, PeaCliIdentity.DirectoryName, PeaCliIdentity.CurrentVersionFileName),
                Path.Combine(binRootPath, PeaCliIdentity.DirectoryName, PeaCliIdentity.VersionsDirectoryName),
                Path.Combine(binRootPath, PeaCliIdentity.DirectoryName, PeaCliIdentity.PackagesDirectoryName)
            ),
            new ProductRuntimeStateLayout(stateRootPath),
            new ProductRuntimeLogLayout(logsRootPath),
            new ProductRuntimeCacheLayout(cacheRootPath)
        );
    }
}

public sealed record ProductRuntimeBinaryLayout(
    string RootPath,
    string HostDirectoryPath,
    string HostExecutablePath,
    string HostCurrentVersionPath,
    string HostVersionsDirectoryPath,
    string PeaDirectoryPath,
    string PeaLauncherPath,
    string PeaCurrentVersionPath,
    string PeaVersionsDirectoryPath,
    string PeaPackagesDirectoryPath
) {
    public string ResolveHostVersionInstalledExecutablePath(string version) =>
        Path.Combine(
            ProductPathing.ResolveSafeSubDirectoryPath(
                this.HostVersionsDirectoryPath,
                PeaCliIdentity.NormalizePayloadVersion(version),
                nameof(version)
            ),
            HostProcessIdentity.ExecutableName
        );

    public string ResolvePeaVersionDirectoryPath(string version) =>
        ProductPathing.ResolveSafeSubDirectoryPath(
            this.PeaVersionsDirectoryPath,
            PeaCliIdentity.NormalizePayloadVersion(version),
            nameof(version)
        );

    public string ResolvePeaPackageArchivePath(string version) =>
        Path.Combine(this.PeaPackagesDirectoryPath, PeaCliIdentity.CreatePayloadArchiveFileName(version));

    public string ResolvePeaPackageManifestPath(string version) =>
        Path.Combine(this.PeaPackagesDirectoryPath, PeaCliIdentity.CreatePayloadManifestFileName(version));

    public string ResolvePeaVersionInstalledExecutablePath(string version) =>
        Path.Combine(
            this.ResolvePeaVersionDirectoryPath(version),
            PeaCliIdentity.AppDirectoryName,
            PeaCliIdentity.InstalledExecutableName
        );
}

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
