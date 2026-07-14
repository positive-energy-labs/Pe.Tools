using Pe.Shared.StorageRuntime.Json;

namespace Pe.Shared.StorageRuntime;

public sealed class StateStorage {
    private const string DefaultName = "state";

    public StateStorage(string parentDirectoryPath, string? subdirectory = null) => this.DirectoryPath =
        ResolveDirectoryPath(parentDirectoryPath, subdirectory ?? DefaultName);

    public string DirectoryPath { get; }

    public static StateStorage ExactDir(string directoryPath) {
        var resolvedDirectoryPath = EnsureDirectory(directoryPath);
        return new StateStorage(resolvedDirectoryPath, useExactDirectory: true);
    }

    public static StateStorage ExactDir(string directoryPath, string legacyDirectoryPath) {
        var resolvedDirectoryPath = EnsureDirectory(directoryPath);
        TryMigrateLegacyDirectory(resolvedDirectoryPath, legacyDirectoryPath);
        return new StateStorage(resolvedDirectoryPath, useExactDirectory: true);
    }

    public JsonReadWriter<T> Json<T>() where T : class, new() =>
        new LocalDiskJsonFile<T>(this.GetJsonPath(DefaultName));

    public JsonReadWriter<T> Json<T>(string filename) where T : class, new() =>
        new LocalDiskJsonFile<T>(this.GetJsonPath(filename));

    public CsvReadWriter<T> Csv<T>() where T : class, new() =>
        new Csv<T>(this.GetCsvPath(DefaultName));

    public CsvReadWriter<T> Csv<T>(string filename) where T : class, new() =>
        new Csv<T>(this.GetCsvPath(filename));

    public string ResolveSafeRelativeJsonPath(string relativePath) =>
        SettingsPathing.ResolveSafeRelativeJsonPath(this.DirectoryPath, relativePath, nameof(relativePath));

    private string GetJsonPath(string filename) =>
        Path.Combine(this.DirectoryPath, StorageFileUtils.EnsureExtension(filename, ".json"));

    private string GetCsvPath(string filename) =>
        Path.Combine(this.DirectoryPath, StorageFileUtils.EnsureExtension(filename, ".csv"));

    private StateStorage(string directoryPath, bool useExactDirectory) {
        _ = useExactDirectory;
        this.DirectoryPath = EnsureDirectory(directoryPath);
    }

    private static string ResolveDirectoryPath(string parentDirectoryPath, string subdirectory) {
        if (string.IsNullOrWhiteSpace(parentDirectoryPath))
            throw new ArgumentException("Parent directory is required.", nameof(parentDirectoryPath));

        var directoryPath = SettingsPathing.ResolveSafeSubDirectoryPath(
            parentDirectoryPath,
            subdirectory,
            nameof(subdirectory)
        );
        return EnsureDirectory(directoryPath);
    }

    private static string EnsureDirectory(string directoryPath) {
        if (string.IsNullOrWhiteSpace(directoryPath))
            throw new ArgumentException("Directory path is required.", nameof(directoryPath));

        var fullPath = Path.GetFullPath(directoryPath);
        _ = Directory.CreateDirectory(fullPath);
        return fullPath;
    }

    private static void TryMigrateLegacyDirectory(string directoryPath, string legacyDirectoryPath) {
        if (string.IsNullOrWhiteSpace(legacyDirectoryPath))
            return;

        var resolvedLegacyDirectoryPath = Path.GetFullPath(legacyDirectoryPath);
        if (!Directory.Exists(resolvedLegacyDirectoryPath))
            return;

        if (string.Equals(directoryPath, resolvedLegacyDirectoryPath, StringComparison.OrdinalIgnoreCase))
            return;

        if (Directory.EnumerateFileSystemEntries(directoryPath).Any())
            return;

        CopyDirectoryContents(resolvedLegacyDirectoryPath, directoryPath);
    }

    private static void CopyDirectoryContents(string sourceDirectoryPath, string destinationDirectoryPath) {
        foreach (var sourceDirectory in Directory.EnumerateDirectories(sourceDirectoryPath, "*", SearchOption.AllDirectories)) {
            var relativePath = BclCompat.GetRelativePath(sourceDirectoryPath, sourceDirectory);
            _ = Directory.CreateDirectory(Path.Combine(destinationDirectoryPath, relativePath));
        }

        foreach (var sourceFilePath in Directory.EnumerateFiles(sourceDirectoryPath, "*", SearchOption.AllDirectories)) {
            var relativePath = BclCompat.GetRelativePath(sourceDirectoryPath, sourceFilePath);
            var destinationFilePath = Path.Combine(destinationDirectoryPath, relativePath);
            var destinationParent = Path.GetDirectoryName(destinationFilePath);
            if (!string.IsNullOrWhiteSpace(destinationParent))
                _ = Directory.CreateDirectory(destinationParent);

            File.Copy(sourceFilePath, destinationFilePath, overwrite: false);
        }
    }
}
