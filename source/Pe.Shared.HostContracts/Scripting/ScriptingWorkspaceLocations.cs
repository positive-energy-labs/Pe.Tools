namespace Pe.Shared.HostContracts.Scripting;

public static class ScriptingWorkspaceLocations {
    public const string DefaultScriptingDirectoryName = "Pe.Scripting";
    public const string WorkspaceDirectoryName = "workspace";

    public static string GetDefaultBasePath() =>
        Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.MyDocuments),
            DefaultScriptingDirectoryName
        );

    public static string ResolveWorkspaceRoot(string workspaceKey) {
        if (string.IsNullOrWhiteSpace(workspaceKey))
            throw new ArgumentException("Workspace key is required.", nameof(workspaceKey));

        var normalizedWorkspaceKey = workspaceKey
            .Trim()
            .Replace(Path.AltDirectorySeparatorChar, Path.DirectorySeparatorChar);
        if (Path.IsPathRooted(normalizedWorkspaceKey))
            throw new ArgumentException("Workspace key must be relative.", nameof(workspaceKey));

        var workspaceDirectory = Path.GetFullPath(Path.Combine(GetDefaultBasePath(), WorkspaceDirectoryName));
        var workspaceRoot = Path.GetFullPath(Path.Combine(workspaceDirectory, normalizedWorkspaceKey));
        var workspaceDirectoryWithSeparator = EnsureTrailingSeparator(workspaceDirectory);
        if (!workspaceRoot.StartsWith(workspaceDirectoryWithSeparator, StringComparison.OrdinalIgnoreCase))
            throw new ArgumentException($"Workspace key escapes the workspace root: {workspaceKey}", nameof(workspaceKey));

        return workspaceRoot;
    }

    private static string EnsureTrailingSeparator(string path) =>
        path.EndsWith(Path.DirectorySeparatorChar.ToString(), StringComparison.Ordinal)
        || path.EndsWith(Path.AltDirectorySeparatorChar.ToString(), StringComparison.Ordinal)
            ? path
            : path + Path.DirectorySeparatorChar;
}
