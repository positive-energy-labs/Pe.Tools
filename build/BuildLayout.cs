using Pe.Shared.HostContracts.Protocol;

namespace Build;

public sealed record BuildLayout(
    string RepositoryRoot,
    string ArtifactsRoot,
    string BuildRoot,
    string PublishRoot,
    string PackagesRoot,
    string BundlePackagesRoot,
    string AutomationPackagesRoot,
    string InstallerPackagesRoot,
    string AutomationStagingRoot,
    string RevitPublishRoot,
    string HostPublishRoot,
    string ToolsRoot
) {
    public string GetProjectBuildRoot(string projectName, string configuration) =>
        Path.Combine(this.BuildRoot, projectName, configuration);

    public string GetProjectBinRoot(string projectName, string configuration) =>
        Path.Combine(this.GetProjectBuildRoot(projectName, configuration), "bin", configuration);

    public string GetProjectBinDirectory(string projectName, string configuration, string targetFramework) =>
        Path.Combine(this.GetProjectBinRoot(projectName, configuration), targetFramework);

    public string GetProjectObjRoot(string projectName, string configuration) =>
        Path.Combine(this.GetProjectBuildRoot(projectName, configuration), "obj");

    public string GetRevitPublishDirectory(string configuration) =>
        Path.Combine(this.RevitPublishRoot, configuration);

    public string GetHostPublishDirectory(string configuration) =>
        Path.Combine(this.HostPublishRoot, configuration, SettingsEditorRuntime.HostFolderName);

    public string GetAutomationStagingDirectory(string configuration, string bundleName) =>
        Path.Combine(this.AutomationStagingRoot, configuration, $"{bundleName}.bundle");
}
