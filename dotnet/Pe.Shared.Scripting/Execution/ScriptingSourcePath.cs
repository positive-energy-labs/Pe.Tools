namespace Pe.Shared.Scripting.Execution;

public static class ScriptingSourcePath {
    /// <summary>A script is any `.cs` or `.csx` member of a Pod, wherever it lives (pods map, contract C1).</summary>
    public static bool IsScript(string path) =>
        path.EndsWith(".cs", StringComparison.OrdinalIgnoreCase) || path.EndsWith(".csx", StringComparison.OrdinalIgnoreCase);

    public static string NormalizeWorkspaceSourcePath(string sourcePath, string owner = "Scripting source path") {
        if (Path.IsPathRooted(sourcePath))
            throw new ArgumentException($"{owner} must be relative.", nameof(sourcePath));

        var normalized = sourcePath.Replace('\\', '/').Trim();
        if (string.IsNullOrWhiteSpace(normalized))
            throw new ArgumentException($"{owner} is required.", nameof(sourcePath));
        if (normalized.StartsWith("/", StringComparison.Ordinal) || normalized.EndsWith("/", StringComparison.Ordinal) || normalized.Contains("//", StringComparison.Ordinal))
            throw new ArgumentException($"{owner} must be a safe relative path.", nameof(sourcePath));

        var segments = normalized.Split('/');
        var invalidSegment = segments.FirstOrDefault(segment =>
            string.IsNullOrWhiteSpace(segment) ||
            segment == "." ||
            segment == ".." ||
            segment.IndexOfAny(Path.GetInvalidFileNameChars()) >= 0
        );
        if (invalidSegment is not null)
            throw new ArgumentException($"Invalid {owner} segment '{invalidSegment}'.", nameof(sourcePath));

        if (!IsScript(normalized))
            throw new ArgumentException($"{owner} must reference a .cs or .csx file.", nameof(sourcePath));

        return string.Join("/", segments);
    }
}
