using Pe.Global.PolyFill;

namespace Pe.Global.Services.Storage.Core;

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

        var segments = normalized.SplitAndTrim('/', StringSplitOptions.RemoveEmptyEntries);
        if (segments.Length == 0)
            throw new ArgumentException("Relative path is required.", paramName);

        var fileSegment = segments[^1];
        var extension = Path.GetExtension(fileSegment);
        if (!string.IsNullOrEmpty(extension) && !extension.Equals(".json", StringComparison.OrdinalIgnoreCase))
            throw new ArgumentException(
                $"Unsupported extension '{extension}'. Use .json or omit extension.",
                paramName
            );

        var normalizedFileName = string.IsNullOrEmpty(extension)
            ? fileSegment
            : Path.GetFileNameWithoutExtension(fileSegment);
        if (string.IsNullOrWhiteSpace(normalizedFileName))
            throw new ArgumentException("Relative path must include a file name.", paramName);

        var directorySegments = segments.Take(segments.Length - 1);
        var safeRelativeWithExtension = directorySegments
            .Append($"{normalizedFileName}.json")
            .JoinWith(Path.DirectorySeparatorChar);

        var combined = Path.GetFullPath(Path.Combine(rootPath, safeRelativeWithExtension));
        EnsurePathUnderRoot(combined, rootPath, paramName);
        return combined;
    }

    public static string NormalizeRelativePath(string? input, string paramName) {
        if (string.IsNullOrWhiteSpace(input))
            return string.Empty;

        var normalized = input.Replace('\\', '/').Trim('/');
        if (string.IsNullOrWhiteSpace(normalized))
            return string.Empty;

        var segments = normalized.SplitAndTrim('/', StringSplitOptions.RemoveEmptyEntries);
        if (segments.Length == 0)
            return string.Empty;

        var invalidSegment = segments.FirstOrDefault(segment =>
            segment == "." ||
            segment == ".." ||
            segment.IndexOfAny(Path.GetInvalidFileNameChars()) >= 0
        );
        if (!string.IsNullOrWhiteSpace(invalidSegment))
            throw new ArgumentException(
                $"Invalid relative path segment '{invalidSegment}'.",
                paramName
            );

        return segments.JoinWith('/');
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
}

public static class SettingsDiscoveryBuilder {
    public static SettingsFileEntry CreateSettingsFileEntry(string absoluteFilePath, string settingsRootPath) {
        var fileInfo = new FileInfo(absoluteFilePath);
        var relativePath = BclExtensions.GetRelativePath(settingsRootPath, absoluteFilePath).Replace('\\', '/');
        var relativePathWithoutExtension = Path.ChangeExtension(relativePath, null) ?? relativePath;
        var normalizedDirectory = Path.GetDirectoryName(relativePath)?.Replace('\\', '/');
        var relativeSegments = relativePath.SplitAndTrim(
            '/',
            StringSplitOptions.RemoveEmptyEntries | (StringSplitOptions)2 /* TrimEntries, polyfill for net48 */);
        var isSchema = fileInfo.Name.Equals("schema.json", StringComparison.OrdinalIgnoreCase) ||
                       fileInfo.Name.Equals("fragment.schema.json", StringComparison.OrdinalIgnoreCase);
        var isFragmentDirectory = relativeSegments.Any(segment =>
            segment.StartsWith("_", StringComparison.OrdinalIgnoreCase));
        var isFragment = isFragmentDirectory;
        var kind = isSchema
            ? SettingsFileKind.Schema
            : isFragment
                ? SettingsFileKind.Fragment
                : SettingsFileKind.Profile;

        return new SettingsFileEntry(
            fileInfo.FullName,
            relativePath,
            relativePathWithoutExtension,
            fileInfo.Name,
            Path.GetFileNameWithoutExtension(fileInfo.Name),
            string.IsNullOrWhiteSpace(normalizedDirectory) ? null : normalizedDirectory,
            new DateTimeOffset(fileInfo.LastWriteTimeUtc, TimeSpan.Zero),
            kind,
            isFragment,
            isSchema
        );
    }

    public static SettingsDirectoryNode BuildDirectoryTree(
        string rootName,
        string rootRelativePath,
        List<SettingsFileEntry> files
    ) {
        var root = new SettingsDirectoryNode(rootName, rootRelativePath, [], []);
        foreach (var file in files) {
            var localRelativePath = GetLocalRelativePath(file.RelativePath, rootRelativePath);
            var localSegments = localRelativePath.SplitAndTrim('/', StringSplitOptions.RemoveEmptyEntries);
            if (localSegments.Length == 0)
                continue;

            var fileName = localSegments[^1];
            var directorySegments = localSegments.Take(localSegments.Length - 1);
            var current = root;
            var currentRelative = rootRelativePath;
            foreach (var segment in directorySegments) {
                currentRelative = string.IsNullOrWhiteSpace(currentRelative)
                    ? segment
                    : $"{currentRelative}/{segment}";
                var existing = current.Directories.FirstOrDefault(d =>
                    string.Equals(d.Name, segment, StringComparison.OrdinalIgnoreCase));
                if (existing == null) {
                    existing = new SettingsDirectoryNode(segment, currentRelative, [], []);
                    current.Directories.Add(existing);
                }

                current = existing;
            }

            current.Files.Add(new SettingsFileNode(
                fileName,
                file.RelativePath,
                file.RelativePathWithoutExtension,
                file.RelativePathWithoutExtension,
                file.ModifiedUtc,
                file.Kind,
                file.IsFragment,
                file.IsSchema
            ));
        }

        SortTree(root);
        return root;
    }

    private static string GetLocalRelativePath(string fileRelativePath, string rootRelativePath) {
        if (string.IsNullOrWhiteSpace(rootRelativePath))
            return fileRelativePath;

        var prefix = $"{rootRelativePath.TrimEnd('/')}/";
        if (fileRelativePath.StartsWith(prefix, StringComparison.OrdinalIgnoreCase))
            return fileRelativePath[prefix.Length..];
        if (string.Equals(fileRelativePath, rootRelativePath, StringComparison.OrdinalIgnoreCase))
            return Path.GetFileName(fileRelativePath);

        return fileRelativePath;
    }

    private static void SortTree(SettingsDirectoryNode node) {
        node.Directories.Sort((left, right) => string.Compare(left.Name, right.Name, StringComparison.OrdinalIgnoreCase));
        node.Files.Sort((left, right) => string.Compare(left.Name, right.Name, StringComparison.OrdinalIgnoreCase));

        foreach (var directory in node.Directories)
            SortTree(directory);
    }
}
