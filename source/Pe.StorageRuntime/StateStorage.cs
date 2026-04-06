using Pe.StorageRuntime.Json;

namespace Pe.StorageRuntime;

public sealed class StateStorage {
    private const string DefaultName = "state";

    public StateStorage(string parentDirectoryPath, string? subdirectory = null) {
        this.DirectoryPath = ResolveDirectoryPath(parentDirectoryPath, subdirectory ?? DefaultName);
    }

    public string DirectoryPath { get; }

    public JsonReadWriter<T> Json<T>() where T : class, new() =>
        new LocalDiskJsonFile<T>(this.GetJsonPath(DefaultName));

    public JsonReadWriter<T> Json<T>(string filename) where T : class, new() =>
        new LocalDiskJsonFile<T>(this.GetJsonPath(filename));

    public JsonReadWriter<T> JsonByRelativePath<T>(string relativePath) where T : class, new() =>
        new LocalDiskJsonFile<T>(this.ResolveSafeRelativeJsonPath(relativePath));

    public CsvReadWriter<T> Csv<T>() where T : class, new() =>
        new Csv<T>(this.GetCsvPath(DefaultName));

    public CsvReadWriter<T> Csv<T>(string filename) where T : class, new() =>
        new Csv<T>(this.GetCsvPath(filename));

    public SettingsDiscoveryResult Discover(SettingsDiscoveryOptions? options = null) {
        options ??= new SettingsDiscoveryOptions();
        var discoveryRootPath = SettingsPathing.ResolveSafeSubDirectoryPath(
            this.DirectoryPath,
            options.SubDirectory,
            nameof(options.SubDirectory)
        );
        var normalizedRootRelativePath = SettingsPathing.NormalizeRelativePath(
            options.SubDirectory,
            nameof(options.SubDirectory)
        );
        var rootName = string.IsNullOrWhiteSpace(normalizedRootRelativePath)
            ? DefaultName
            : normalizedRootRelativePath.Split('/').Last();

        if (!Directory.Exists(discoveryRootPath))
            return new SettingsDiscoveryResult([], new SettingsDirectoryNode(rootName, normalizedRootRelativePath, [], []));

        var searchOption = options.Recursive ? SearchOption.AllDirectories : SearchOption.TopDirectoryOnly;
        var files = Directory.EnumerateFiles(discoveryRootPath, "*.json", searchOption)
            .Select(path => SettingsDiscoveryBuilder.CreateSettingsFileEntry(path, this.DirectoryPath))
            .Where(entry => options.IncludeFragments || !entry.IsFragment)
            .Where(entry => options.IncludeSchemas || !entry.IsSchema)
            .OrderByDescending(entry => entry.ModifiedUtc)
            .ToList();
        var tree = SettingsDiscoveryBuilder.BuildDirectoryTree(rootName, normalizedRootRelativePath, files);
        return new SettingsDiscoveryResult(files, tree);
    }

    public StateStorage SubDir(string subdirectory) =>
        new(this.DirectoryPath, SettingsPathing.NormalizeRelativePath(subdirectory, nameof(subdirectory)));

    public string ResolveSafeRelativeJsonPath(string relativePath) =>
        SettingsPathing.ResolveSafeRelativeJsonPath(this.DirectoryPath, relativePath, nameof(relativePath));

    private string GetJsonPath(string filename) =>
        Path.Combine(this.DirectoryPath, StorageFileUtils.EnsureExtension(filename, ".json"));

    private string GetCsvPath(string filename) =>
        Path.Combine(this.DirectoryPath, StorageFileUtils.EnsureExtension(filename, ".csv"));

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
