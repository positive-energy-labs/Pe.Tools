namespace Pe.Shared.Product;

/// <summary>The user home's <c>Pods</c> folder, where a person's new pod is created. A pod in another home is named by the host, by absolute folder.</summary>
public sealed record ScriptingWorkspaceLayout(string RootPath) {
    public const string DefaultWorkspaceKey = "default";
    public const string ProjectFileName = "PeScripts.csproj";
    public const string AgentInstructionsFileName = ProductPathNames.AgentInstructionsFileName;
    public const string ReadmeFileName = ProductPathNames.ReadmeFileName;
    public const string PodManifestFileName = ProductPathNames.PodManifestFileName;
    public const string SourceDirectoryName = "src";
    public const string SampleScriptFileName = "SampleScript.cs";

    /// <summary>The per-machine props file every pod's <see cref="ProjectFileName" /> imports (homes freeze shape 8).</summary>
    /// <remarks>Its path and its import spelling are <see cref="ProductPathing.MachinePropsPath" /> and <see cref="ProductPathing.MachinePropsImport" />.</remarks>
    public const string MachinePropsFileName = "PeScripts.props";

    public string ResolveWorkspaceRoot(string? workspaceKey) =>
        ProductPathing.ResolveSafeSubDirectoryPath(
            this.RootPath,
            NormalizeWorkspaceKey(workspaceKey),
            nameof(workspaceKey)
        );

    public string ResolveProjectFilePath(string? workspaceKey) =>
        Path.Combine(this.ResolveWorkspaceRoot(workspaceKey), ProjectFileName);

    public string ResolvePodManifestPath(string? workspaceKey) =>
        Path.Combine(this.ResolveWorkspaceRoot(workspaceKey), PodManifestFileName);

    public string ResolveSourceDirectoryPath(string? workspaceKey) =>
        Path.Combine(this.ResolveWorkspaceRoot(workspaceKey), SourceDirectoryName);

    public string ResolveSampleScriptPath(string? workspaceKey) =>
        Path.Combine(this.ResolveSourceDirectoryPath(workspaceKey), SampleScriptFileName);

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

        if (normalized.Contains('/') || normalized.EndsWith(".", StringComparison.Ordinal)
            || !string.Equals(normalized, workspaceKey, StringComparison.Ordinal))
            throw new ArgumentException(
                "Workspace key must be one exact local folder name, without path separators or trailing dots/spaces.",
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
