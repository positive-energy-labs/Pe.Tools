using Pe.Shared.Product;

namespace Pe.Shared.Scripting.Execution;

public static class ScriptingSourcePath {
    public static string NormalizeWorkspaceSourcePath(string sourcePath, string owner = "Scripting source path") {
        if (Path.IsPathRooted(sourcePath))
            throw new ArgumentException($"{owner} must be relative.", nameof(sourcePath));

        var normalized = sourcePath.Replace('\\', '/').Trim();
        if (string.IsNullOrWhiteSpace(normalized))
            throw new ArgumentException($"{owner} is required.", nameof(sourcePath));
        if (normalized.StartsWith("/", StringComparison.Ordinal) || normalized.EndsWith("/", StringComparison.Ordinal) || normalized.Contains("//", StringComparison.Ordinal))
            throw new ArgumentException($"{owner} must be a safe relative path.", nameof(sourcePath));

        var segments = normalized.Split('/');
        if (segments.Length < 2 || !string.Equals(segments[0], ScriptingWorkspaceLayout.SourceDirectoryName, StringComparison.Ordinal))
            throw new ArgumentException($"{owner} must live under src/.", nameof(sourcePath));

        var invalidSegment = segments.FirstOrDefault(segment =>
            string.IsNullOrWhiteSpace(segment) ||
            segment == "." ||
            segment == ".." ||
            segment.IndexOfAny(Path.GetInvalidFileNameChars()) >= 0
        );
        if (invalidSegment is not null)
            throw new ArgumentException($"Invalid {owner} segment '{invalidSegment}'.", nameof(sourcePath));

        if (!normalized.EndsWith(".cs", StringComparison.OrdinalIgnoreCase))
            throw new ArgumentException($"{owner} must reference a .cs file.", nameof(sourcePath));

        return string.Join("/", segments);
    }
}
