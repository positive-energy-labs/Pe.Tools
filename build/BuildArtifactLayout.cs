namespace Build;

public sealed record BuildArtifactLayout(
    string ArtifactsRoot,
    string PublishRoot,
    string PackagesRoot,
    string BundlePackagesRoot,
    string AutomationPackagesRoot,
    string InstallerPackagesRoot,
    string ReceiptsRoot,
    string ToolsRoot
) {
    public static BuildArtifactLayout ForRepository(string repositoryRoot) {
        var artifactsRoot = Path.GetFullPath(Path.Combine(repositoryRoot, ".artifacts"));
        var packagesRoot = Path.Combine(artifactsRoot, "packages");

        return new BuildArtifactLayout(
            EnsureTrailingSeparator(artifactsRoot),
            EnsureTrailingSeparator(Path.Combine(artifactsRoot, "publish")),
            EnsureTrailingSeparator(packagesRoot),
            EnsureTrailingSeparator(Path.Combine(packagesRoot, "bundles")),
            EnsureTrailingSeparator(Path.Combine(packagesRoot, "automation")),
            EnsureTrailingSeparator(Path.Combine(packagesRoot, "installers")),
            EnsureTrailingSeparator(Path.Combine(artifactsRoot, "receipts")),
            EnsureTrailingSeparator(Path.Combine(artifactsRoot, "tools"))
        );
    }

    private static string EnsureTrailingSeparator(string path) =>
        path.EndsWith(Path.DirectorySeparatorChar) || path.EndsWith(Path.AltDirectorySeparatorChar)
            ? path
            : path + Path.DirectorySeparatorChar;
}
