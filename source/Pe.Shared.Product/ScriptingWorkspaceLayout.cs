namespace Pe.Shared.Product;

public sealed record ScriptingWorkspaceLayout(string RootPath) {
    public const string DefaultWorkspaceKey = "default";
    public const string ProjectFileName = "PeScripts.csproj";
    public const string AgentInstructionsFileName = ProductPathNames.AgentInstructionsFileName;
    public const string ReadmeFileName = ProductPathNames.ReadmeFileName;
    public const string PodManifestFileName = ProductPathNames.PodManifestFileName;
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

    public string ResolvePodManifestPath(string? workspaceKey) =>
        Path.Combine(this.ResolveWorkspaceRoot(workspaceKey), PodManifestFileName);

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
        if (string.IsNullOrWhiteSpace(normalized))
            return DefaultWorkspaceKey;

        if (!IsWorkspaceSlug(normalized))
            throw new ArgumentException(
                "Workspace key must be a single lowercase slug segment using letters, digits, and hyphen separators.",
                nameof(workspaceKey)
            );

        return normalized;
    }

    public static bool IsWorkspaceSlug(string value) {
        if (string.IsNullOrWhiteSpace(value))
            return false;

        var expectSlugCharacter = true;
        var lastWasHyphen = false;
        foreach (var character in value) {
            var isSlugCharacter = character is >= 'a' and <= 'z' or >= '0' and <= '9';
            if (isSlugCharacter) {
                expectSlugCharacter = false;
                lastWasHyphen = false;
                continue;
            }

            if (character == '-' && !expectSlugCharacter && !lastWasHyphen) {
                lastWasHyphen = true;
                continue;
            }

            return false;
        }

        return !expectSlugCharacter && !lastWasHyphen;
    }
}
