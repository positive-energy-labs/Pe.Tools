namespace Pe.Shared.StorageRuntime;

/// <summary>
///     Shared helpers for safe settings path resolution and settings discovery projections.
/// </summary>
public static class SettingsPathing {
    public static string ResolveSafeSubDirectoryPath(string rootPath, string? subdirectory, string paramName) {
        var normalized = NormalizeRelativePath(subdirectory, paramName);
        if (string.IsNullOrWhiteSpace(normalized))
            return rootPath;

        var combined = Path.GetFullPath(Path.Combine(rootPath, normalized.Replace('/', Path.DirectorySeparatorChar)));
        EnsurePathUnderRoot(combined, rootPath, paramName);
        return combined;
    }

    public static string ResolveSafeRelativeJsonPath(string rootPath, string relativePath, string paramName) {
        var normalized = NormalizeRelativePath(relativePath, paramName);
        if (string.IsNullOrWhiteSpace(normalized))
            throw new ArgumentException("Relative path is required.", paramName);

        var segments = SplitAndTrim(normalized!, '/');
        if (segments.Length == 0)
            throw new ArgumentException("Relative path is required.", paramName);

        var fileSegment = segments[^1];
        var extension = Path.GetExtension(fileSegment);
        if (!string.IsNullOrEmpty(extension) && !extension.Equals(".json", StringComparison.OrdinalIgnoreCase)) {
            throw new ArgumentException(
                $"Unsupported extension '{extension}'. Use .json or omit extension.",
                paramName
            );
        }

        var normalizedFileName = string.IsNullOrEmpty(extension)
            ? fileSegment
            : Path.GetFileNameWithoutExtension(fileSegment);
        if (string.IsNullOrWhiteSpace(normalizedFileName))
            throw new ArgumentException("Relative path must include a file name.", paramName);

        var directorySegments = segments.Take(segments.Length - 1);
        var safeRelativeWithExtension = string.Join(
            Path.DirectorySeparatorChar.ToString(),
            directorySegments.Append($"{normalizedFileName}.json")
        );

        var combined = Path.GetFullPath(Path.Combine(rootPath, safeRelativeWithExtension));
        EnsurePathUnderRoot(combined, rootPath, paramName);
        return combined;
    }

    public static string NormalizeRelativePath(string? input, string paramName) {
        var normalized = input?.Replace('\\', '/').Trim('/');
        if (string.IsNullOrWhiteSpace(normalized))
            return string.Empty;

        var segments = SplitAndTrim(normalized!, '/');
        if (segments.Length == 0)
            return string.Empty;

        var invalidSegment = segments.FirstOrDefault(segment =>
            segment == "." ||
            segment == ".." ||
            segment.IndexOfAny(Path.GetInvalidFileNameChars()) >= 0
        );
        if (!string.IsNullOrWhiteSpace(invalidSegment)) {
            throw new ArgumentException(
                $"Invalid relative path segment '{invalidSegment}'.",
                paramName
            );
        }

        return string.Join("/", segments);
    }

    public static void EnsurePathUnderRoot(string candidatePath, string rootPath, string paramName) {
        var normalizedRoot = Path.GetFullPath(rootPath)
            .TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar);
        var normalizedCandidate = Path.GetFullPath(candidatePath)
            .TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar);
        var rootPrefix = normalizedRoot + Path.DirectorySeparatorChar;

        var isUnderRoot = normalizedCandidate.StartsWith(rootPrefix, StringComparison.OrdinalIgnoreCase) ||
                          string.Equals(normalizedCandidate, normalizedRoot, StringComparison.OrdinalIgnoreCase);
        if (!isUnderRoot)
            throw new ArgumentException("Resolved path escapes the settings root.", paramName);
    }

    private static string[] SplitAndTrim(string value, char separator) =>
        value
            .Split([separator], StringSplitOptions.RemoveEmptyEntries)
            .Select(segment => segment.Trim())
            .Where(segment => !string.IsNullOrWhiteSpace(segment))
            .ToArray();
}
