using Pe.Shared.HostContracts.Scripting;
using Pe.Shared.Product;
using Pe.Shared.StorageRuntime;

namespace Pe.Revit.Scripting.Storage;

public static class RevitScriptingStorageLocations {
    public const string ScriptingDirectoryName = ScriptingWorkspaceLocations.DefaultScriptingDirectoryName;
    public const string ProjectFileName = ScriptingWorkspaceLayout.ProjectFileName;
    public const string AgentsFileName = ScriptingWorkspaceLayout.AgentInstructionsFileName;
    public const string ReadmeFileName = ScriptingWorkspaceLayout.ReadmeFileName;
    public const string SourceDirectoryName = ScriptingWorkspaceLayout.SourceDirectoryName;
    public const string InlineTraceDirectoryName = ScriptingWorkspaceLayout.InlineDirectoryName;
    public const string SampleFileName = ScriptingWorkspaceLayout.SampleScriptFileName;
    public static string GetDefaultBasePath() => ScriptingWorkspaceLocations.GetDefaultBasePath();

    public static string ResolveInlineTraceDirectory() =>
        Path.Combine(GetDefaultBasePath(), InlineTraceDirectoryName);

    public static string ResolveWorkspaceRoot(string workspaceKey) =>
        ScriptingWorkspaceLocations.ResolveWorkspaceRoot(workspaceKey);

    public static string ResolveProjectFilePath(string workspaceKey) =>
        Path.Combine(ResolveWorkspaceRoot(workspaceKey), ProjectFileName);

    public static string ResolveSourceDirectory(string workspaceKey) =>
        Path.Combine(ResolveWorkspaceRoot(workspaceKey), SourceDirectoryName);

    public static string ResolveWorkspaceSourceFilePath(string workspaceKey, string relativePath) {
        var workspaceRoot = ResolveWorkspaceRoot(workspaceKey);
        var normalizedRelativePath = SettingsPathing.NormalizeRelativePath(relativePath, nameof(relativePath));
        if (string.IsNullOrWhiteSpace(normalizedRelativePath))
            throw new ArgumentException("Workspace source path is required.", nameof(relativePath));

        var fullPath = Path.GetFullPath(Path.Combine(
            workspaceRoot,
            normalizedRelativePath.Replace('/', Path.DirectorySeparatorChar)
        ));
        SettingsPathing.EnsurePathUnderRoot(fullPath, workspaceRoot, nameof(relativePath));
        return fullPath;
    }

    public static string ResolveGeneratedDirectory(string workspaceKey) =>
        Path.Combine(ResolveWorkspaceRoot(workspaceKey), ".vscode");

    public static string ResolveSampleScriptPath(string workspaceKey) =>
        Path.Combine(ResolveSourceDirectory(workspaceKey), SampleFileName);

    public static string ResolveReadmePath(string workspaceKey) =>
        Path.Combine(ResolveWorkspaceRoot(workspaceKey), ReadmeFileName);

    public static string ResolveAgentsPath(string workspaceKey) =>
        Path.Combine(ResolveWorkspaceRoot(workspaceKey), AgentsFileName);

    public static string ResolveVscodeSettingsPath(string workspaceKey) =>
        Path.Combine(ResolveGeneratedDirectory(workspaceKey), "settings.json");
}