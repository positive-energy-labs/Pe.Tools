namespace Pe.Shared.StorageRuntime;

public static class SettingsDiscoveryBuilder {
    public static SettingsFileEntry CreateSettingsFileEntry(string absoluteFilePath, string settingsRootPath) {
        var fileInfo = new FileInfo(absoluteFilePath);
        var relativePath = BclCompat.GetRelativePath(settingsRootPath, absoluteFilePath).Replace('\\', '/');
        var relativePathWithoutExtension = Path.ChangeExtension(relativePath, null) ?? relativePath;
        var normalizedDirectory = Path.GetDirectoryName(relativePath)?.Replace('\\', '/');
        var relativeSegments = relativePath.SplitAndTrim(
            '/',
            StringSplitOptions.RemoveEmptyEntries | (StringSplitOptions)2
        );
        var isSchema = fileInfo.Name.EndsWith(".schema.json", StringComparison.OrdinalIgnoreCase) ||
                       fileInfo.Name.Equals("schema.json", StringComparison.OrdinalIgnoreCase);
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
    ) => BuildDirectoryTree(rootName, rootRelativePath, files, []);

    public static SettingsDirectoryNode BuildDirectoryTree(
        string rootName,
        string rootRelativePath,
        List<SettingsFileEntry> files,
        IEnumerable<string> directoryRelativePaths
    ) {
        var root = new SettingsDirectoryNode(rootName, rootRelativePath, [], []);

        foreach (var directoryRelativePath in directoryRelativePaths
                     .Where(path => !string.IsNullOrWhiteSpace(path))
                     .Distinct(StringComparer.OrdinalIgnoreCase)) {
            var localRelativePath = GetLocalRelativePath(directoryRelativePath, rootRelativePath);
            var localSegments = localRelativePath.SplitAndTrim('/', StringSplitOptions.RemoveEmptyEntries);
            if (localSegments.Length == 0)
                continue;

            EnsureDirectoryNode(root, rootRelativePath, localSegments);
        }

        foreach (var file in files) {
            var localRelativePath = GetLocalRelativePath(file.RelativePath, rootRelativePath);
            var localSegments = localRelativePath.SplitAndTrim('/', StringSplitOptions.RemoveEmptyEntries);
            if (localSegments.Length == 0)
                continue;

            var fileName = localSegments[^1];
            var directorySegments = localSegments.Take(localSegments.Length - 1);
            var current = EnsureDirectoryNode(root, rootRelativePath, directorySegments);

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

    private static SettingsDirectoryNode EnsureDirectoryNode(
        SettingsDirectoryNode root,
        string rootRelativePath,
        IEnumerable<string> directorySegments
    ) {
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

        return current;
    }

    private static void SortTree(SettingsDirectoryNode node) {
        node.Directories.Sort((left, right) =>
            string.Compare(left.Name, right.Name, StringComparison.OrdinalIgnoreCase));
        node.Files.Sort((left, right) => string.Compare(left.Name, right.Name, StringComparison.OrdinalIgnoreCase));

        foreach (var directory in node.Directories)
            SortTree(directory);
    }
}