using Pe.Shared.HostContracts.Scripting;
using Pe.Revit.Scripting.Storage;

namespace Pe.Revit.Scripting.Bootstrap;

public sealed class ScriptWorkspaceBootstrapService(
    ScriptProjectGenerator projectGenerator
) {
    private readonly ScriptProjectGenerator _projectGenerator = projectGenerator;

    public ScriptWorkspaceBootstrapData Bootstrap(
        string workspaceKey,
        bool createSampleScript,
        string revitVersion,
        string targetFramework,
        string runtimeAssemblyPath
    ) {
        var generatedFiles = new List<string>();
        var workspaceRoot = RevitScriptingStorageLocations.ResolveWorkspaceRoot(workspaceKey);
        var projectFilePath = RevitScriptingStorageLocations.ResolveProjectFilePath(workspaceKey);
        var sourceDirectory = RevitScriptingStorageLocations.ResolveSourceDirectory(workspaceKey);
        var vscodeDirectory = RevitScriptingStorageLocations.ResolveGeneratedDirectory(workspaceKey);
        var inlineDirectory = RevitScriptingStorageLocations.ResolveInlineDirectory(workspaceKey);
        var sampleScriptPath = RevitScriptingStorageLocations.ResolveSampleScriptPath(workspaceKey);
        var agentsPath = RevitScriptingStorageLocations.ResolveAgentsPath(workspaceKey);
        var readmePath = RevitScriptingStorageLocations.ResolveReadmePath(workspaceKey);
        var vscodeSettingsPath = RevitScriptingStorageLocations.ResolveVscodeSettingsPath(workspaceKey);

        Directory.CreateDirectory(workspaceRoot);
        Directory.CreateDirectory(sourceDirectory);
        Directory.CreateDirectory(vscodeDirectory);
        Directory.CreateDirectory(inlineDirectory);

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

        EnsureFile(agentsPath, ScriptFileTemplates.CreateAgents(), generatedFiles);
        EnsureFile(readmePath, ScriptFileTemplates.CreateReadme(), generatedFiles);
        EnsureFile(vscodeSettingsPath, ScriptFileTemplates.CreateVscodeSettings(), generatedFiles);
        if (createSampleScript)
            EnsureFile(sampleScriptPath, ScriptFileTemplates.CreateSampleScript(), generatedFiles);

        return new ScriptWorkspaceBootstrapData(
            workspaceKey,
            workspaceRoot,
            projectFilePath,
            sampleScriptPath,
            readmePath,
            revitVersion,
            targetFramework,
            runtimeAssemblyPath,
            generatedFiles
        );
    }

    private static void EnsureFile(string path, string content, List<string> generatedFiles) {
        if (File.Exists(path))
            return;

        Directory.CreateDirectory(Path.GetDirectoryName(path)!);
        File.WriteAllText(path, content);
        generatedFiles.Add(path);
    }

    private static void WriteIfChanged(string path, string content, List<string> generatedFiles) {
        var existingContent = File.Exists(path) ? File.ReadAllText(path) : null;
        if (string.Equals(existingContent, content, StringComparison.Ordinal))
            return;

        Directory.CreateDirectory(Path.GetDirectoryName(path)!);
        File.WriteAllText(path, content);
        generatedFiles.Add(path);
    }
}
