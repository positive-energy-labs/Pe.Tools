using Pe.Revit.Scripting.Storage;
using Pe.Shared.HostContracts.Scripting;
using Pe.Shared.Product;

namespace Pe.Revit.Scripting.Bootstrap;

public sealed class ScriptWorkspaceBootstrapService(
    ScriptProjectGenerator projectGenerator,
    Func<string, string>? workspaceRootResolver = null,
    string? productHomePath = null
) {
    private readonly ScriptProjectGenerator _projectGenerator = projectGenerator;
    private readonly Func<string, string> _workspaceRootResolver = workspaceRootResolver ?? RevitScriptingStorageLocations.ResolveWorkspaceRoot;
    private readonly string _productHomePath = productHomePath ?? RevitScriptingStorageLocations.ResolveProductHomePath();

    public ScriptWorkspaceBootstrapData Bootstrap(
        string workspaceKey,
        bool createSampleScript,
        string revitVersion,
        string targetFramework,
        string runtimeAssemblyPath,
        bool preserveProject = false
    ) {
        var generatedFiles = new List<string>();
        var productHomePath = this._productHomePath;
        var productAgentsPath = Path.Combine(productHomePath, RevitScriptingStorageLocations.AgentsFileName);
        var productReadmePath = Path.Combine(productHomePath, RevitScriptingStorageLocations.ReadmeFileName);
        var workspaceRoot = this._workspaceRootResolver(workspaceKey);
        var projectFilePath = Path.Combine(workspaceRoot, RevitScriptingStorageLocations.ProjectFileName);
        var sourceDirectory = Path.Combine(workspaceRoot, RevitScriptingStorageLocations.SourceDirectoryName);
        var settingsDirectory = Path.Combine(workspaceRoot, ProductPathNames.SettingsDirectoryName);
        var assetsDirectory = Path.Combine(workspaceRoot, ProductPathNames.AssetsDirectoryName);
        var outputDirectory = Path.Combine(workspaceRoot, ProductPathNames.OutputDirectoryName);
        var vscodeDirectory = Path.Combine(workspaceRoot, ".vscode");
        var sampleScriptPath = Path.Combine(sourceDirectory, RevitScriptingStorageLocations.SampleFileName);
        var podManifestPath = Path.Combine(workspaceRoot, RevitScriptingStorageLocations.PodManifestFileName);
        var agentsPath = Path.Combine(workspaceRoot, RevitScriptingStorageLocations.AgentsFileName);
        var readmePath = Path.Combine(workspaceRoot, RevitScriptingStorageLocations.ReadmeFileName);
        var vscodeSettingsPath = Path.Combine(vscodeDirectory, "settings.json");

        _ = Directory.CreateDirectory(productHomePath);
        _ = Directory.CreateDirectory(workspaceRoot);
        _ = Directory.CreateDirectory(sourceDirectory);
        _ = Directory.CreateDirectory(settingsDirectory);
        _ = Directory.CreateDirectory(assetsDirectory);
        _ = Directory.CreateDirectory(outputDirectory);
        _ = Directory.CreateDirectory(vscodeDirectory);

        var existingProjectContent = File.Exists(projectFilePath)
            ? File.ReadAllText(projectFilePath)
            : null;
        var generatedProjectContent = this._projectGenerator.GenerateProjectContent(
            existingProjectContent,
            workspaceRoot,
            revitVersion,
            targetFramework,
            runtimeAssemblyPath
        );
        if (!preserveProject)
            WriteIfChanged(projectFilePath, generatedProjectContent, generatedFiles);

        // The root AGENTS.md is the one high-level guide and the only file rewritten: an existing
        // tree picks corrected guidance up on the next bootstrap. Everything else is create-once,
        // because a pod's own AGENTS.md and both READMEs are the user's to edit.
        WriteIfChanged(productAgentsPath, ScriptFileTemplates.CreateRootAgents(), generatedFiles);
        EnsureFile(productReadmePath, ScriptFileTemplates.CreateRootReadme(), generatedFiles);
        EnsureFile(agentsPath, ScriptFileTemplates.CreatePodAgents(), generatedFiles);
        EnsureFile(readmePath, ScriptFileTemplates.CreatePodReadme(), generatedFiles);
        EnsureFile(vscodeSettingsPath, ScriptFileTemplates.CreateVscodeSettings(), generatedFiles);
        if (createSampleScript) {
            EnsureFile(sampleScriptPath, ScriptFileTemplates.CreateSampleScript(), generatedFiles);
            EnsureFile(podManifestPath, ScriptFileTemplates.CreatePodManifest(workspaceKey), generatedFiles);
        }

        return new ScriptWorkspaceBootstrapData(
            workspaceKey,
            productHomePath,
            productAgentsPath,
            productReadmePath,
            workspaceRoot,
            agentsPath,
            readmePath,
            projectFilePath,
            podManifestPath,
            sampleScriptPath,
            revitVersion,
            targetFramework,
            runtimeAssemblyPath,
            generatedFiles
        );
    }

    private static void EnsureFile(string path, string content, List<string> generatedFiles) {
        if (File.Exists(path))
            return;

        _ = Directory.CreateDirectory(Path.GetDirectoryName(path)!);
        File.WriteAllText(path, content);
        generatedFiles.Add(path);
    }

    private static void WriteIfChanged(string path, string content, List<string> generatedFiles) {
        var existingContent = File.Exists(path) ? File.ReadAllText(path) : null;
        if (string.Equals(existingContent, content, StringComparison.Ordinal))
            return;

        _ = Directory.CreateDirectory(Path.GetDirectoryName(path)!);
        File.WriteAllText(path, content);
        generatedFiles.Add(path);
    }
}
