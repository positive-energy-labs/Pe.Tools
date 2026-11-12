using Pe.Revit.Scripting.Pods;
using Pe.Revit.Scripting.Storage;
using Pe.Shared.HostContracts.Scripting;
using Pe.Shared.Product;

namespace Pe.Revit.Scripting.Bootstrap;

/// <summary>
///     Seeds a pod for script authoring (homes freeze shape 8). A pod may sit in a shared home, so bootstrap
///     writes into it only authored seeds, each create-exclusive: the same bytes on every machine, and never over
///     a file that exists. Everything this machine derives goes outside every home: the props file the pod's
///     project imports, and the agent's guide in the agent's working directory.
/// </summary>
public sealed class ScriptWorkspaceBootstrapService(
    ScriptProjectGenerator projectGenerator,
    Func<string, string>? podFolderResolver = null,
    string? agentDirectory = null,
    string? machinePropsPath = null
) {
    private readonly ScriptProjectGenerator _projectGenerator = projectGenerator;
    private readonly Func<string, string> _podFolderResolver = podFolderResolver ?? new ScriptPodPreparationService().ResolveBootstrapFolder;
    private readonly string? _agentDirectory = agentDirectory;
    private readonly string _machinePropsPath = machinePropsPath ?? ProductPathing.MachinePropsPath;

    public ScriptWorkspaceBootstrapData Bootstrap(
        string workspaceKey,
        string revitVersion,
        string targetFramework,
        string runtimeAssemblyPath
    ) {
        var generatedFiles = new List<string>();
        var podFolder = this._podFolderResolver(workspaceKey);
        var agentsPath = Path.Combine(podFolder, RevitScriptingStorageLocations.AgentsFileName);
        var readmePath = Path.Combine(podFolder, RevitScriptingStorageLocations.ReadmeFileName);
        var projectFilePath = Path.Combine(podFolder, RevitScriptingStorageLocations.ProjectFileName);
        var podManifestPath = Path.Combine(podFolder, RevitScriptingStorageLocations.PodManifestFileName);
        var agentGuidePath = Path.Combine(
            this._agentDirectory ?? ProductRuntimeLayout.Current.State.AgentPath, ProductPathNames.AgentInstructionsFileName);

        foreach (var directoryName in new[] {
                     RevitScriptingStorageLocations.SourceDirectoryName, ProductPathNames.SettingsDirectoryName, ProductPathNames.AssetsDirectoryName
                 })
            _ = Directory.CreateDirectory(Path.Combine(podFolder, directoryName));

        // An empty pod: a manifest with no entrypoints. Shipped examples arrive by import, never by bootstrap.
        Seed(podManifestPath, ScriptFileTemplates.CreatePodManifest(workspaceKey), generatedFiles);
        Seed(projectFilePath, ScriptFileTemplates.CreateProject(), generatedFiles);
        Seed(agentsPath, ScriptFileTemplates.CreatePodAgents(), generatedFiles);
        Seed(readmePath, ScriptFileTemplates.CreatePodReadme(), generatedFiles);

        // The two machine files are the only ones rewritten: a later bootstrap corrects them in place.
        WriteIfChanged(this._machinePropsPath,
            this._projectGenerator.GenerateMachineProps(targetFramework, runtimeAssemblyPath), generatedFiles);
        WriteIfChanged(agentGuidePath, ScriptFileTemplates.CreateAgentGuide(), generatedFiles);

        return new ScriptWorkspaceBootstrapData(
            workspaceKey,
            ProductPathing.UserRoot(),
            agentGuidePath,
            podFolder,
            agentsPath,
            readmePath,
            projectFilePath,
            podManifestPath,
            this._machinePropsPath,
            revitVersion,
            targetFramework,
            runtimeAssemblyPath,
            generatedFiles
        );
    }

    /// <summary>Create-exclusive: a file that exists, written by this machine or another, is left alone.</summary>
    private static void Seed(string path, string content, List<string> generatedFiles) {
        _ = Directory.CreateDirectory(Path.GetDirectoryName(path)!);
        try {
            using var stream = new FileStream(path, FileMode.CreateNew, FileAccess.Write, FileShare.None);
            using var writer = new StreamWriter(stream, new System.Text.UTF8Encoding(false));
            writer.Write(content);
        } catch (IOException) when (File.Exists(path)) {
            return;
        }
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
