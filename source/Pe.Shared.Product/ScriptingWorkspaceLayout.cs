namespace Pe.Shared.Product;

public sealed record ScriptingWorkspaceLayout(string RootPath) {
    public const string DefaultWorkspaceKey = "default";
    public const string ProjectFileName = "PeScripts.csproj";
    public const string AgentInstructionsFileName = ProductPathNames.AgentInstructionsFileName;
    public const string ReadmeFileName = ProductPathNames.ReadmeFileName;
    public const string SourceDirectoryName = "src";
    public const string SampleScriptFileName = "SampleScript.cs";
    public const string VsCodeDirectoryName = ".vscode";
    public const string VsCodeSettingsFileName = "settings.json";

    public string ResolveWorkspaceRoot(string? workspaceKey) =>
        ProductPathing.ResolveSafeSubDirectoryPath(
            this.RootPath,
            NormalizeWorkspaceKey(workspaceKey),
            nameof(workspaceKey)
        );

    public string ResolveProjectFilePath(string? workspaceKey) =>
        Path.Combine(this.ResolveWorkspaceRoot(workspaceKey), ProjectFileName);

    public string ResolveAgentInstructionsPath(string? workspaceKey) =>
        Path.Combine(this.ResolveWorkspaceRoot(workspaceKey), AgentInstructionsFileName);

    public string ResolveReadmePath(string? workspaceKey) =>
        Path.Combine(this.ResolveWorkspaceRoot(workspaceKey), ReadmeFileName);

    public string ResolveSourceDirectoryPath(string? workspaceKey) =>
        Path.Combine(this.ResolveWorkspaceRoot(workspaceKey), SourceDirectoryName);

    public string ResolveSampleScriptPath(string? workspaceKey) =>
        Path.Combine(this.ResolveSourceDirectoryPath(workspaceKey), SampleScriptFileName);

    public string ResolveVsCodeSettingsPath(string? workspaceKey) =>
        Path.Combine(this.ResolveWorkspaceRoot(workspaceKey), VsCodeDirectoryName, VsCodeSettingsFileName);

    public string ResolveWorkspaceSourceFilePath(string? workspaceKey, string relativePath) =>
        ProductPathing.ResolveSafeRelativeFilePath(
            this.ResolveSourceDirectoryPath(workspaceKey),
            relativePath,
            nameof(relativePath)
        );

    public static string NormalizeWorkspaceKey(string? workspaceKey) {
        var normalized = ProductPathing.NormalizeRelativePath(workspaceKey, nameof(workspaceKey));
        return string.IsNullOrWhiteSpace(normalized) ? DefaultWorkspaceKey : normalized;
    }
}
