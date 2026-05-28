namespace Pe.Shared.Product;

public sealed record ProductBuildLayoutProjection(
    ProductBuildRuntimeProjection Runtime,
    ProductBuildDevelopmentRuntimeProjection DevelopmentRuntime,
    ProductBuildUserContentProjection UserContent,
    ProductBuildRevitProjection Revit
) {
    public static ProductBuildLayoutProjection CreateDefault() {
        var runtimeRootRelativePath = Path.Combine(
            ProductIdentity.VendorName,
            ProductIdentity.ProductName
        );
        var runtimeBinRelativePath = Path.Combine(runtimeRootRelativePath, ProductPathNames.BinDirectoryName);
        var developmentRuntimeRootRelativePath = Path.Combine(runtimeRootRelativePath, ProductPathNames.DevelopmentDirectoryName);
        var developmentRuntimeBinRelativePath = Path.Combine(
            developmentRuntimeRootRelativePath,
            ProductPathNames.BinDirectoryName
        );
        var hostDirectoryRelativePath = Path.Combine(runtimeBinRelativePath, HostProcessIdentity.DirectoryName);
        var developmentHostDirectoryRelativePath = Path.Combine(
            developmentRuntimeBinRelativePath,
            HostProcessIdentity.DirectoryName
        );
        var peaDirectoryRelativePath = Path.Combine(runtimeBinRelativePath, PeaCliIdentity.DirectoryName);
        var peDevDirectoryRelativePath = Path.Combine(runtimeBinRelativePath, PeDevCliIdentity.DirectoryName);
        var stateRelativePath = Path.Combine(runtimeRootRelativePath, ProductPathNames.StateDirectoryName);
        var logsRelativePath = Path.Combine(runtimeRootRelativePath, ProductPathNames.LogsDirectoryName);
        var cacheRelativePath = Path.Combine(runtimeRootRelativePath, ProductPathNames.CacheDirectoryName);
        var userContentRootRelativePath = ProductIdentity.ProductName;
        var addinsRootRelativePath = Path.Combine(
            RevitDeploymentIdentity.AutodeskDirectoryName,
            RevitDeploymentIdentity.RevitDirectoryName,
            RevitDeploymentIdentity.AddinsDirectoryName
        );

        return new ProductBuildLayoutProjection(
            new ProductBuildRuntimeProjection(
                runtimeRootRelativePath,
                new ProductBuildBinaryProjection(
                    runtimeBinRelativePath,
                    hostDirectoryRelativePath,
                    Path.Combine(hostDirectoryRelativePath, HostProcessIdentity.ExecutableName),
                    Path.Combine(hostDirectoryRelativePath, HostProcessIdentity.DllName),
                    peaDirectoryRelativePath,
                    Path.Combine(peaDirectoryRelativePath, PeaCliIdentity.LauncherName),
                    Path.Combine(peaDirectoryRelativePath, PeaCliIdentity.CurrentVersionFileName),
                    Path.Combine(peaDirectoryRelativePath, PeaCliIdentity.VersionsDirectoryName),
                    Path.Combine(peaDirectoryRelativePath, PeaCliIdentity.PackagesDirectoryName),
                    peDevDirectoryRelativePath,
                    Path.Combine(peDevDirectoryRelativePath, PeDevCliIdentity.ExecutableName),
                    Path.Combine(peDevDirectoryRelativePath, PeDevCliIdentity.DllName)
                ),
                stateRelativePath,
                logsRelativePath,
                cacheRelativePath
            ),
            new ProductBuildDevelopmentRuntimeProjection(
                developmentRuntimeRootRelativePath,
                new ProductBuildDevelopmentBinaryProjection(
                    developmentRuntimeBinRelativePath,
                    developmentHostDirectoryRelativePath,
                    Path.Combine(developmentHostDirectoryRelativePath, HostProcessIdentity.ExecutableName),
                    Path.Combine(developmentHostDirectoryRelativePath, HostProcessIdentity.DllName),
                    peDevDirectoryRelativePath,
                    Path.Combine(peDevDirectoryRelativePath, PeDevCliIdentity.ExecutableName),
                    Path.Combine(peDevDirectoryRelativePath, PeDevCliIdentity.DllName)
                )
            ),
            new ProductBuildUserContentProjection(
                userContentRootRelativePath,
                Path.Combine(userContentRootRelativePath, ProductPathNames.SettingsDirectoryName),
                Path.Combine(userContentRootRelativePath, ProductPathNames.WorkspacesDirectoryName),
                Path.Combine(userContentRootRelativePath, ProductPathNames.InlineScriptsDirectoryName),
                Path.Combine(userContentRootRelativePath, ProductPathNames.OutputDirectoryName)
            ),
            new ProductBuildRevitProjection(
                addinsRootRelativePath,
                RevitDeploymentIdentity.AddinManifestFileName
            )
        );
    }
}

public sealed record ProductBuildRuntimeProjection(
    string RootRelativePath,
    ProductBuildBinaryProjection Binaries,
    string StateRelativePath,
    string LogsRelativePath,
    string CacheRelativePath
);

public sealed record ProductBuildDevelopmentRuntimeProjection(
    string RootRelativePath,
    ProductBuildDevelopmentBinaryProjection Binaries
);

public sealed record ProductBuildBinaryProjection(
    string RootRelativePath,
    string HostDirectoryRelativePath,
    string HostExecutableRelativePath,
    string HostDllRelativePath,
    string PeaDirectoryRelativePath,
    string PeaLauncherRelativePath,
    string PeaCurrentVersionRelativePath,
    string PeaVersionsRelativePath,
    string PeaPackagesRelativePath,
    string PeDevDirectoryRelativePath,
    string PeDevExecutableRelativePath,
    string PeDevDllRelativePath
);

public sealed record ProductBuildDevelopmentBinaryProjection(
    string RootRelativePath,
    string HostDirectoryRelativePath,
    string HostExecutableRelativePath,
    string HostDllRelativePath,
    string PeDevDirectoryRelativePath,
    string PeDevExecutableRelativePath,
    string PeDevDllRelativePath
);

public sealed record ProductBuildUserContentProjection(
    string RootRelativePath,
    string SettingsRelativePath,
    string WorkspacesRelativePath,
    string InlineScriptsRelativePath,
    string OutputRelativePath
);

public sealed record ProductBuildRevitProjection(
    string AddinsRootRelativePath,
    string AddinManifestFileName
);
