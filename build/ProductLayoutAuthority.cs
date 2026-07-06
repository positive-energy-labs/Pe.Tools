using Pe.Shared.Product;

namespace Build;

public sealed record ProductLayoutAuthority(
    string RepositoryRoot,
    ProductBuildLayoutProjection Product,
    BuildArtifactLayout Artifacts
) {
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

    public string GetSdkInstallerRevitPayloadRoot() =>
        Path.Combine(this.Artifacts.PublishRoot, "installer", "revit");

    public string GetSdkInstallerPayloadManifestPath(string version) =>
        Path.Combine(
            this.Artifacts.InstallerPackagesRoot,
            $"{ProductIdentity.ProductName}.sdk-payloads.{SanitizeFileNameSegment(version)}.json"
        );

    public string GetSdkInstallerOutputRoot() =>
        Path.Combine(this.Artifacts.ArtifactsRoot, "out", "installers");

    private static string SanitizeFileNameSegment(string value) {
        var invalidCharacters = Path.GetInvalidFileNameChars();
        var characters = value.Select(character => invalidCharacters.Contains(character) ? '-' : character).ToArray();
        return new string(characters);
    }
}
