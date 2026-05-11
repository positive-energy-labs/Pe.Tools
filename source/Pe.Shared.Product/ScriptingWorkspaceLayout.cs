namespace Pe.Shared.Product;

public sealed record ScriptingWorkspaceLayout(string RootPath) {
    public const string DefaultWorkspaceKey = "default";
    public const string ProjectFileName = "PeScripts.csproj";
    public const string AgentInstructionsFileName = "AGENTS.md";
    public const string ReadmeFileName = "README.md";
    public const string SourceDirectoryName = "src";
    public const string InlineDirectoryName = ".inline";
    public const string SampleScriptFileName = "SampleScript.cs";
    public const string VsCodeDirectoryName = ".vscode";
    public const string VsCodeSettingsFileName = "settings.json";

    public string ResolveWorkspaceRoot(string? workspaceKey) =>
        ProductPathing.ResolveSafeSubDirectoryPath(
            Path.Combine(this.RootPath, ProductPathNames.WorkspaceDirectoryName),
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

    public string ResolveInlineDirectoryPath(string? workspaceKey) =>
        Path.Combine(this.ResolveWorkspaceRoot(workspaceKey), InlineDirectoryName);

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
