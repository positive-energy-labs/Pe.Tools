using Pe.StorageRuntime.Json;
using Pe.StorageRuntime;
using Pe.StorageRuntime.PolyFill;
using Pe.StorageRuntime.Revit.Core.Json;

namespace Pe.StorageRuntime.Revit.Core;

public abstract class BaseLocalManager {
    protected BaseLocalManager(string parentDir, string subDirName) {
        this.Name = subDirName;
        this.DirectoryPath = Path.Combine(parentDir, this.Name);
        _ = Directory.CreateDirectory(this.DirectoryPath);
    }

    public abstract string Name { get; init; }
    public string DirectoryPath { get; init; }

    public string GetJsonPath(string? filename = null) {
        var name = filename ?? this.Name;
        var nameWithExt = FileUtils.EnsureExtension(name, ".json");
        return Path.Combine(this.DirectoryPath, nameWithExt);
    }

    public string GetDatedJsonPath(string? filename = null) {
        var name = filename ?? this.Name;
        if (name.EndsWith(".json", StringComparison.OrdinalIgnoreCase))
            name = name[..^5];

        var nameWithTimestamp = $"{name}_{DateTime.Now:yyyy-MM-dd_HH-mm-ss}";
        var nameWithExt = FileUtils.EnsureExtension(nameWithTimestamp, ".json");
        return Path.Combine(this.DirectoryPath, nameWithExt);
    }

    public string GetCsvPath(string? filename = null) =>
        Path.Combine(this.DirectoryPath, filename ?? $"{this.Name}.csv");

    public string GetDatedCsvPath(string? filename = null) =>
        Path.Combine(this.DirectoryPath, $"{filename ?? this.Name}_{DateTime.Now:yyyy-MM-dd_HH-mm-ss}.csv");
}

public class StateManager : BaseLocalManager {
    private const string DefaultName = "state";

    public StateManager(string parentPath) : base(parentPath, DefaultName) { }
    private StateManager(string parentPath, string subDirName) : base(parentPath, subDirName) { }

    public override string Name { get; init; } = DefaultName;

    public JsonReadWriter<T> Json<T>() where T : class, new() =>
        new ComposableJson<T>(this.GetJsonPath(), this.DirectoryPath, JsonBehavior.State);

    public JsonReadWriter<T> Json<T>(string filename) where T : class, new() =>
        new ComposableJson<T>(this.GetJsonPath(filename), this.DirectoryPath, JsonBehavior.State);

    public JsonReadWriter<T> JsonByRelativePath<T>(string relativePath) where T : class, new() =>
        new ComposableJson<T>(
            this.ResolveSafeRelativeJsonPath(relativePath),
            this.DirectoryPath,
            JsonBehavior.State
        );

    public string ResolveSafeRelativeJsonPath(string relativePath) =>
        SettingsPathing.ResolveSafeRelativeJsonPath(
            this.DirectoryPath,
            relativePath,
            nameof(relativePath)
        );

    public SettingsDiscoveryResult Discover(SettingsDiscoveryOptions? options = null) {
        options ??= new SettingsDiscoveryOptions();
        var discoveryRootPath = this.ResolveSafeSubDirectoryPath(options.SubDirectory);
        var normalizedRootRelativePath =
            SettingsPathing.NormalizeRelativePath(options.SubDirectory, nameof(options.SubDirectory));
        var rootName = string.IsNullOrWhiteSpace(normalizedRootRelativePath)
            ? this.Name
            : normalizedRootRelativePath.Split('/').Last();

        if (!Directory.Exists(discoveryRootPath)) {
            return new SettingsDiscoveryResult(
                [],
                new SettingsDirectoryNode(rootName, normalizedRootRelativePath, [], [])
            );
        }

        var searchOption = options.Recursive ? SearchOption.AllDirectories : SearchOption.TopDirectoryOnly;
        var files = Directory.EnumerateFiles(discoveryRootPath, "*.json", searchOption)
            .Select(path => SettingsDiscoveryBuilder.CreateSettingsFileEntry(path, this.DirectoryPath))
            .Where(entry => options.IncludeFragments || !entry.IsFragment)
            .Where(entry => options.IncludeSchemas || !entry.IsSchema)
            .OrderByDescending(entry => entry.ModifiedUtc)
            .ToList();

        var tree = SettingsDiscoveryBuilder.BuildDirectoryTree(
            rootName,
            normalizedRootRelativePath,
            files
        );
        return new SettingsDiscoveryResult(files, tree);
    }

    public StateManager SubDir(string subdirectory) {
        var resolvedSubdirectoryPath = this.ResolveSafeSubDirectoryPath(subdirectory);
        var relativeSubdirectoryPath = BclExtensions.GetRelativePath(this.DirectoryPath, resolvedSubdirectoryPath);
        return new StateManager(this.DirectoryPath, relativeSubdirectoryPath);
    }

    public CsvReadWriter<T> Csv<T>() where T : class, new() =>
        new Csv<T>(this.GetCsvPath());

    public CsvReadWriter<T> Csv<T>(string filename) where T : class, new() =>
        new Csv<T>(this.GetCsvPath(filename));

    private string ResolveSafeSubDirectoryPath(string? subdirectory) =>
        SettingsPathing.ResolveSafeSubDirectoryPath(
            this.DirectoryPath,
            subdirectory,
            nameof(subdirectory)
        );
}

public class OutputManager : BaseLocalManager {
    public OutputManager(string parentPath) : base(parentPath, "output") { }
    private OutputManager(string parentPath, string subDirName) : base(parentPath, subDirName) { }
    public override string Name { get; init; } = "output";

    public static OutputManager ExactDir(string directoryPath) {
        if (string.IsNullOrWhiteSpace(directoryPath))
            throw new ArgumentException("Directory path cannot be null, empty, or whitespace.", nameof(directoryPath));

        var fullPath = Path.GetFullPath(directoryPath);
        var parentPath = Path.GetDirectoryName(fullPath);
        var directoryName = Path.GetFileName(fullPath);

        if (string.IsNullOrWhiteSpace(parentPath) || string.IsNullOrWhiteSpace(directoryName))
            throw new ArgumentException($"Directory path '{directoryPath}' must include a parent directory and folder name.",
                nameof(directoryPath));

        return new OutputManager(parentPath, directoryName);
    }

    public JsonWriter<object> Json(string filename) =>
        new ComposableJson<object>(this.GetJsonPath(filename), this.DirectoryPath, JsonBehavior.Output);

    public JsonWriter<object> JsonDated(string filename) =>
        new ComposableJson<object>(this.GetDatedJsonPath(filename), this.DirectoryPath, JsonBehavior.Output);

    public CsvWriter<object> Csv(string filename) =>
        new Csv<object>(this.GetCsvPath(filename));

    public CsvWriter<object> CsvDated(string filename) =>
        new Csv<object>(this.GetDatedCsvPath(filename));

    public OutputManager SubDir(string subdirectory) {
        var subdirectoryPath = Path.Combine(this.DirectoryPath, subdirectory);
        if (Path.GetFullPath(subdirectoryPath).StartsWith(Path.GetFullPath(this.DirectoryPath)))
            return new OutputManager(this.DirectoryPath, subdirectory);

        throw new ArgumentException($"Subdirectory path '{subdirectory}' would escape base directory.");
    }

    public OutputManager TimestampedSubDir(string? prefix = null) {
        var timestamp = DateTime.Now.ToString("yyyy-MM-dd_HH-mm-ss");
        var dirName = string.IsNullOrWhiteSpace(prefix) ? timestamp : $"{prefix}_{timestamp}";
        return this.SubDir(dirName);
    }
}
