namespace Build;

public sealed record BuildArtifactLayout(
    string ArtifactsRoot,
    string BuildRoot,
    string PublishRoot,
    string PackagesRoot,
    string BundlePackagesRoot,
    string AutomationPackagesRoot,
    string PeaPackagesRoot,
    string InstallerPackagesRoot,
    string AutomationStagingRoot,
    string ToolsRoot
) {
    public static BuildArtifactLayout ForRepository(string repositoryRoot) {
        var artifactsRoot = Path.GetFullPath(Path.Combine(repositoryRoot, ".artifacts"));
        var packagesRoot = Path.Combine(artifactsRoot, "packages");

        return new BuildArtifactLayout(
            EnsureTrailingSeparator(artifactsRoot),
            EnsureTrailingSeparator(Path.Combine(artifactsRoot, "build")),
            EnsureTrailingSeparator(Path.Combine(artifactsRoot, "publish")),
            EnsureTrailingSeparator(packagesRoot),
            EnsureTrailingSeparator(Path.Combine(packagesRoot, "bundles")),
            EnsureTrailingSeparator(Path.Combine(packagesRoot, "automation")),
            EnsureTrailingSeparator(Path.Combine(packagesRoot, "pea")),
            EnsureTrailingSeparator(Path.Combine(packagesRoot, "installers")),
            EnsureTrailingSeparator(Path.Combine(artifactsRoot, "staging", "automation")),
            EnsureTrailingSeparator(Path.Combine(artifactsRoot, "tools"))
        );
    }

    public string GetProjectBuildRoot(string projectName, string configuration) =>
        Path.Combine(this.BuildRoot, projectName, configuration);

    public string GetProjectBinRoot(string projectName, string configuration) =>
        Path.Combine(this.GetProjectBuildRoot(projectName, configuration), "bin", configuration);

    public string GetProjectBinDirectory(string projectName, string configuration, string targetFramework) =>
        Path.Combine(this.GetProjectBinRoot(projectName, configuration), targetFramework);

    public string GetProjectObjRoot(string projectName, string configuration) =>
        Path.Combine(this.GetProjectBuildRoot(projectName, configuration), "obj");

    private static string EnsureTrailingSeparator(string path) =>
        path.EndsWith(Path.DirectorySeparatorChar) || path.EndsWith(Path.AltDirectorySeparatorChar)
            ? path
            : path + Path.DirectorySeparatorChar;
}
