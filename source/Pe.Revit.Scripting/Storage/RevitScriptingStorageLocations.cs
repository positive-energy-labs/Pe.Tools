using Pe.Shared.HostContracts.Scripting;
using Pe.Shared.StorageRuntime;

namespace Pe.Revit.Scripting.Storage;

public static class RevitScriptingStorageLocations {
    public const string ScriptingDirectoryName = ScriptingWorkspaceLocations.DefaultScriptingDirectoryName;
    public const string WorkspaceDirectoryName = ScriptingWorkspaceLocations.WorkspaceDirectoryName;
    public const string ProjectFileName = "PeScripts.csproj";
    public const string AgentsFileName = "AGENTS.md";
    public const string ReadmeFileName = "README.md";
    public const string SourceDirectoryName = "src";
    public const string SampleFileName = "SampleScript.cs";
    public const string InlineDirectoryName = ".inline";
    public const string LastInlineFileName = "LastInline.cs";

    public static string GetDefaultBasePath() => ScriptingWorkspaceLocations.GetDefaultBasePath();

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

    public static string ResolveInlineDirectory(string workspaceKey) =>
        Path.Combine(ResolveWorkspaceRoot(workspaceKey), InlineDirectoryName);

    public static string ResolveLastInlineScriptPath(string workspaceKey) =>
        Path.Combine(ResolveInlineDirectory(workspaceKey), LastInlineFileName);

    public static string ResolveSampleScriptPath(string workspaceKey) =>
        Path.Combine(ResolveSourceDirectory(workspaceKey), SampleFileName);

    public static string ResolveReadmePath(string workspaceKey) =>
        Path.Combine(ResolveWorkspaceRoot(workspaceKey), ReadmeFileName);

    public static string ResolveAgentsPath(string workspaceKey) =>
        Path.Combine(ResolveWorkspaceRoot(workspaceKey), AgentsFileName);

    public static string ResolveVscodeSettingsPath(string workspaceKey) =>
        Path.Combine(ResolveGeneratedDirectory(workspaceKey), "settings.json");
}
