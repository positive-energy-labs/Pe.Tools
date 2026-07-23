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

    public string GetSdkInstallerRevitPayloadRoot() =>
        Path.Combine(this.Artifacts.PublishRoot, "installer", "revit");

    public string GetInstallPackagePath(string version) =>
        Path.Combine(this.Artifacts.InstallerPackagesRoot,
            $"{ProductIdentity.ProductName}.{SanitizeFileNameSegment(version)}.install.zip");

    public string GetSdkInstallerOutputRoot() =>
        Path.Combine(this.Artifacts.ArtifactsRoot, "out", "installers");

    public string GetInstallerReceiptPath(string version) =>
        Path.Combine(this.Artifacts.ReceiptsRoot,
            $"{ProductIdentity.ProductName}.{SanitizeFileNameSegment(version)}.installer.json");

    private static string SanitizeFileNameSegment(string value) {
        var invalidCharacters = Path.GetInvalidFileNameChars();
        var characters = value.Select(character => invalidCharacters.Contains(character) ? '-' : character).ToArray();
        return new string(characters);
    }
}
