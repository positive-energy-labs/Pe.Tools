using System.Text.Json;
using Pe.Shared.Product;

namespace Build;

public sealed record ProductLayoutAuthority(
    string RepositoryRoot,
    ProductBuildLayoutProjection Product,
    BuildArtifactLayout Artifacts
) {
    private static readonly JsonSerializerOptions JsonOptions = new() {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        WriteIndented = true
    };

    public static ProductLayoutAuthority ForRepository(string repositoryRoot) {
        var fullRepositoryRoot = Path.GetFullPath(repositoryRoot);
        return new ProductLayoutAuthority(
            fullRepositoryRoot,
            ProductBuildLayoutProjection.CreateDefault(),
            BuildArtifactLayout.ForRepository(fullRepositoryRoot)
        );
    }

    public string GetRevitPublishDirectory(string configuration) =>
        Path.Combine(this.Artifacts.PublishRoot, "revit", configuration);

    public string GetHostPublishDirectory(string configuration) =>
        Path.Combine(
            this.Artifacts.PublishRoot,
            "host",
            configuration,
            ProductPathNames.BinDirectoryName,
            HostProcessIdentity.DirectoryName
        );

    public string GetPeaPayloadStagingDirectory(string configuration, string version) =>
        Path.Combine(
            this.Artifacts.PublishRoot,
            "pea",
            configuration,
            "payload",
            PeaCliIdentity.NormalizePayloadVersion(version)
        );

    public string GetPeaBootstrapStagingDirectory(string configuration) =>
        Path.Combine(
            this.Artifacts.PublishRoot,
            "pea",
            configuration,
            ProductPathNames.BinDirectoryName,
            PeaCliIdentity.DirectoryName
        );

    public string GetAutomationStagingDirectory(string configuration, string bundleName) =>
        Path.Combine(this.Artifacts.AutomationStagingRoot, configuration, $"{bundleName}.bundle");

    public string GetInstallerPayloadManifestPath(string version) =>
        Path.Combine(this.Artifacts.InstallerPackagesRoot, InstallerPayloadManifest.CreateFileName(version));

    public async Task<string> WriteInstallerPayloadManifestAsync(
        string version,
        string runtimePublishDirectory,
        PeaPayloadArtifacts peaPayload,
        IReadOnlyCollection<string> revitPublishDirectories,
        CancellationToken cancellationToken
    ) {
        Directory.CreateDirectory(this.Artifacts.InstallerPackagesRoot);
        var manifest = InstallerPayloadManifest.Create(
            version,
            this.Artifacts.InstallerPackagesRoot,
            runtimePublishDirectory,
            peaPayload.BootstrapDirectory.Path,
            peaPayload.ArchiveFile.Path,
            peaPayload.ManifestFile.Path,
            revitPublishDirectories
        );
        var manifestPath = this.GetInstallerPayloadManifestPath(version);
        await File.WriteAllTextAsync(manifestPath, JsonSerializer.Serialize(manifest, JsonOptions), cancellationToken);
        return manifestPath;
    }
}
