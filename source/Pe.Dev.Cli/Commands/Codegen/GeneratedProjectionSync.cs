namespace Pe.Dev.Cli.Codegen;

internal static class GeneratedProjectionSync {
    public static void DeleteStaleFiles(
        string repoRoot,
        IEnumerable<string> expectedPaths,
        IEnumerable<string> ownedPaths
    ) {
        var expected = expectedPaths
            .Select(Path.GetFullPath)
            .ToHashSet(StringComparer.OrdinalIgnoreCase);

        foreach (var stalePath in ownedPaths.Select(Path.GetFullPath).Where(path => !expected.Contains(path))) {
            File.Delete(stalePath);
            Console.WriteLine($"Deleted {Path.GetRelativePath(repoRoot, stalePath)}");
        }
    }

    public static void DeleteEmptyDirectories(string repoRoot, IEnumerable<string> rootDirectories) {
        foreach (var rootDirectory in rootDirectories)
            DeleteEmptyDirectories(repoRoot, rootDirectory);
    }

    public static IEnumerable<string> EnumerateFiles(string directory, string pattern, SearchOption searchOption) =>
        Directory.Exists(directory)
            ? Directory.EnumerateFiles(directory, pattern, searchOption).Select(Path.GetFullPath)
            : [];

    private static void DeleteEmptyDirectories(string repoRoot, string rootDirectory) {
        if (!Directory.Exists(rootDirectory))
            return;

        foreach (var directory in Directory
                     .EnumerateDirectories(rootDirectory, "*", SearchOption.AllDirectories)
                     .OrderByDescending(path => path.Length)
                     .Append(rootDirectory)) {
            if (Directory.EnumerateFileSystemEntries(directory).Any())
                continue;

            Directory.Delete(directory);
            Console.WriteLine($"Deleted empty generated directory {Path.GetRelativePath(repoRoot, directory)}");
        }
    }
}
