using Pe.StorageRuntime.Json;

namespace Pe.StorageRuntime;

public sealed class OutputStorage {
    private const string DefaultName = "output";

    public OutputStorage(string parentDirectoryPath, string? subdirectory = null) {
        this.DirectoryPath = ResolveDirectoryPath(parentDirectoryPath, subdirectory ?? DefaultName);
    }

    public string DirectoryPath { get; }

    public static OutputStorage ExactDir(string directoryPath) {
        if (string.IsNullOrWhiteSpace(directoryPath))
            throw new ArgumentException("Directory path cannot be null, empty, or whitespace.", nameof(directoryPath));

        var fullPath = Path.GetFullPath(directoryPath);
        var parentPath = Path.GetDirectoryName(fullPath);
        var directoryName = Path.GetFileName(fullPath);
        if (string.IsNullOrWhiteSpace(parentPath) || string.IsNullOrWhiteSpace(directoryName)) {
            throw new ArgumentException(
                $"Directory path '{directoryPath}' must include a parent directory and folder name.",
                nameof(directoryPath)
            );
        }

        return new OutputStorage(parentPath, directoryName);
    }

    public JsonWriter<object> Json(string filename) =>
        new LocalDiskJsonFile<object>(this.GetJsonPath(filename));

    public JsonWriter<object> JsonDated(string filename) =>
        new LocalDiskJsonFile<object>(this.GetDatedJsonPath(filename));

    public CsvWriter<object> Csv(string filename) =>
        new Csv<object>(this.GetCsvPath(filename));

    public CsvWriter<object> CsvDated(string filename) =>
        new Csv<object>(this.GetDatedCsvPath(filename));

    public OutputStorage SubDir(string subdirectory) =>
        new(this.DirectoryPath, SettingsPathing.NormalizeRelativePath(subdirectory, nameof(subdirectory)));

    public OutputStorage TimestampedSubDir(string? prefix = null) {
        var timestamp = DateTime.Now.ToString("yyyy-MM-dd_HH-mm-ss");
        var directoryName = string.IsNullOrWhiteSpace(prefix) ? timestamp : $"{prefix}_{timestamp}";
        return this.SubDir(directoryName);
    }

    private string GetJsonPath(string filename) =>
        Path.Combine(this.DirectoryPath, StorageFileUtils.EnsureExtension(filename, ".json"));

    private string GetDatedJsonPath(string filename) {
        var basename = Path.GetFileNameWithoutExtension(StorageFileUtils.EnsureExtension(filename, ".json"));
        return Path.Combine(this.DirectoryPath, $"{basename}_{DateTime.Now:yyyy-MM-dd_HH-mm-ss}.json");
    }

    private string GetCsvPath(string filename) =>
        Path.Combine(this.DirectoryPath, StorageFileUtils.EnsureExtension(filename, ".csv"));

    private string GetDatedCsvPath(string filename) {
        var basename = Path.GetFileNameWithoutExtension(StorageFileUtils.EnsureExtension(filename, ".csv"));
        return Path.Combine(this.DirectoryPath, $"{basename}_{DateTime.Now:yyyy-MM-dd_HH-mm-ss}.csv");
    }

    private static string ResolveDirectoryPath(string parentDirectoryPath, string subdirectory) {
        if (string.IsNullOrWhiteSpace(parentDirectoryPath))
            throw new ArgumentException("Parent directory is required.", nameof(parentDirectoryPath));

        var directoryPath = SettingsPathing.ResolveSafeSubDirectoryPath(
            parentDirectoryPath,
            subdirectory,
            nameof(subdirectory)
        );
        _ = Directory.CreateDirectory(directoryPath);
        return directoryPath;
    }
}
