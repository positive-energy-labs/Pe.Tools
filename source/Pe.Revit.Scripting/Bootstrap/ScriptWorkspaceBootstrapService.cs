using Pe.Revit.Scripting.Storage;
using Pe.Shared.HostContracts.Scripting;

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
        string runtimeAssemblyPath
    ) {
        var generatedFiles = new List<string>();
        var productHomePath = this._productHomePath;
        var productAgentsPath = Path.Combine(productHomePath, RevitScriptingStorageLocations.AgentsFileName);
        var productReadmePath = Path.Combine(productHomePath, RevitScriptingStorageLocations.ReadmeFileName);
        var workspaceRoot = this._workspaceRootResolver(workspaceKey);
        var projectFilePath = Path.Combine(workspaceRoot, RevitScriptingStorageLocations.ProjectFileName);
        var sourceDirectory = Path.Combine(workspaceRoot, RevitScriptingStorageLocations.SourceDirectoryName);
        var vscodeDirectory = Path.Combine(workspaceRoot, ".vscode");
        var sampleScriptPath = Path.Combine(sourceDirectory, RevitScriptingStorageLocations.SampleFileName);
        var podManifestPath = Path.Combine(workspaceRoot, RevitScriptingStorageLocations.PodManifestFileName);
        var agentsPath = Path.Combine(workspaceRoot, RevitScriptingStorageLocations.AgentsFileName);
        var readmePath = Path.Combine(workspaceRoot, RevitScriptingStorageLocations.ReadmeFileName);
        var joinGuidePath = Path.Combine(workspaceRoot, RevitScriptingStorageLocations.JoinGuideFileName);
        var vscodeSettingsPath = Path.Combine(vscodeDirectory, "settings.json");

        _ = Directory.CreateDirectory(productHomePath);
        _ = Directory.CreateDirectory(workspaceRoot);
        _ = Directory.CreateDirectory(sourceDirectory);
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
        WriteIfChanged(projectFilePath, generatedProjectContent, generatedFiles);

        EnsureFile(productAgentsPath, ScriptFileTemplates.CreateProductAgents(), generatedFiles);
        EnsureFile(productReadmePath, ScriptFileTemplates.CreateProductReadme(), generatedFiles);
        // AGENTS.md is host-owned agent guidance, not user prose: rewrite it so an existing
        // workspace picks up corrected guidance on the next bootstrap. README/JOIN_GUIDE stay
        // create-once because a user may edit them.
        WriteIfChanged(agentsPath, ScriptFileTemplates.CreateAgents(), generatedFiles);
        EnsureFile(readmePath, ScriptFileTemplates.CreateReadme(), generatedFiles);
        EnsureFile(joinGuidePath, ScriptFileTemplates.CreateJoinGuide(), generatedFiles);
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
