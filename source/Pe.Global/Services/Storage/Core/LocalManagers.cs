using Pe.Global.Services.Storage.Core.Json;
using Pe.Global.PolyFill;
namespace Pe.Global.Services.Storage.Core;

public abstract class BaseLocalManager {
    protected BaseLocalManager(string parentDir, string subDirName) {
        this.Name = subDirName;
        this.DirectoryPath = Path.Combine(parentDir, this.Name);
        _ = Directory.CreateDirectory(this.DirectoryPath);
    }

    public abstract string Name { get; init; }
    public string DirectoryPath { get; init; }

    /// <summary>
    ///     Get the path to the JSON file. Uses the <see cref="Name" /> of the manager by default.
    ///     Automatically adds .json extension if not present.
    /// </summary>
    public string GetJsonPath(string? filename = null) {
        var name = filename ?? this.Name;
        var nameWithExt = FileUtils.EnsureExtension(name, ".json");
        return Path.Combine(this.DirectoryPath, nameWithExt);
    }

    /// <summary>
    ///     Get the path to the JSON file with a timestamp in the filename. Uses the <see cref="Name" /> of the manager by
    ///     default. Automatically adds .json extension if not present.
    /// </summary>
    public string GetDatedJsonPath(string? filename = null) {
        var name = filename ?? this.Name;
        // Remove .json extension if present, since we'll add it after the timestamp
        if (name.EndsWith(".json", StringComparison.OrdinalIgnoreCase))
            name = name[..^5];

        var nameWithTimestamp = $"{name}_{DateTime.Now:yyyy-MM-dd_HH-mm-ss}";
        var nameWithExt = FileUtils.EnsureExtension(nameWithTimestamp, ".json");
        return Path.Combine(this.DirectoryPath, nameWithExt);
    }

    /// <summary>
    ///     Get the path to the CSV file. Uses the <see cref="Name" /> of the manager by default.
    /// </summary>
    public string GetCsvPath(string? filename = null) =>
        Path.Combine(this.DirectoryPath, filename ?? $"{this.Name}.csv");

    /// <summary>
    ///     Get the path to the CSV file with a timestamp in the filename. Uses the <see cref="Name" /> of the manager by
    ///     default.
    /// </summary>
    public string GetDatedCsvPath(string? filename = null) =>
        Path.Combine(this.DirectoryPath, $"{filename ?? this.Name}_{DateTime.Now:yyyy-MM-dd_HH-mm-ss}.csv");
}

public class SettingsManager : BaseLocalManager {
    private const string DefaultName = "settings";

    public SettingsManager(string parentPath) : base(parentPath, DefaultName) { }
    protected SettingsManager(string parentPath, string subDirName) : base(parentPath, subDirName) { }
    public override string Name { get; init; } = DefaultName;

    /// <summary>
    ///     Creates a JSON reader for settings files. Supports $include composition.
    ///     Crashes if file doesn't exist (creates default for user review).
    /// </summary>
    public JsonReader<T> Json<T>() where T : class, new() =>
        new ComposableJson<T>(this.GetJsonPath(), this.DirectoryPath, JsonBehavior.Settings);

    /// <summary>
    ///     Creates a JSON reader for settings files. Supports $include composition.
    ///     Crashes if file doesn't exist (creates default for user review).
    /// </summary>
    public JsonReader<T> Json<T>(string filename) where T : class, new() =>
        new ComposableJson<T>(this.GetJsonPath(filename), this.DirectoryPath, JsonBehavior.Settings);

    /// <summary>
    ///     Creates a JSON reader for a nested relative JSON path under this settings root.
    ///     The relative path may include subdirectories and can omit the .json extension.
    /// </summary>
    public JsonReader<T> JsonByRelativePath<T>(string relativePath) where T : class, new() =>
        new ComposableJson<T>(
            this.ResolveSafeRelativeJsonPath(relativePath),
            this.DirectoryPath,
            JsonBehavior.Settings
        );

    /// <summary>
    ///     Resolves a relative settings file path to an absolute safe JSON path.
    ///     Blocks path traversal and normalizes optional extension usage.
    /// </summary>
    public string ResolveSafeRelativeJsonPath(string relativePath) =>
        SettingsPathing.ResolveSafeRelativeJsonPath(this.DirectoryPath, relativePath, nameof(relativePath));

    /// <summary>
    ///     Discovers settings files under this settings root and returns both flat and tree data.
    /// </summary>
    public SettingsDiscoveryResult Discover(SettingsDiscoveryOptions? options = null) {
        options ??= new SettingsDiscoveryOptions();
        var discoveryRootPath = this.ResolveSafeSubDirectoryPath(options.SubDirectory);
        var normalizedRootRelativePath = SettingsPathing.NormalizeRelativePath(options.SubDirectory, nameof(options.SubDirectory));
        var rootName = string.IsNullOrWhiteSpace(normalizedRootRelativePath)
            ? this.Name
            : normalizedRootRelativePath.Split('/').Last();

        if (!Directory.Exists(discoveryRootPath))
            return new SettingsDiscoveryResult(
                [],
                new SettingsDirectoryNode(rootName, normalizedRootRelativePath, [], [])
            );

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

    /// <summary>
    ///     Navigate to a subdirectory for accessing files within nested folders.
    ///     Supports multi-level nesting via chaining or path strings (e.g., "profiles/production").
    /// </summary>
    /// <param name="subdirectory">The subdirectory path (relative to current directory)</param>
    public SettingsManager SubDir(string subdirectory) {
        var resolvedSubdirectoryPath = this.ResolveSafeSubDirectoryPath(subdirectory);
        var relativeSubdirectoryPath = BclExtensions.GetRelativePath(this.DirectoryPath, resolvedSubdirectoryPath);
        return new SettingsManager(this.DirectoryPath, relativeSubdirectoryPath);
    }

    private string ResolveSafeSubDirectoryPath(string? subdirectory) =>
        SettingsPathing.ResolveSafeSubDirectoryPath(this.DirectoryPath, subdirectory, nameof(subdirectory));
}

public class StateManager : BaseLocalManager {
    private const string DefaultName = "state";

    public StateManager(string parentPath) : base(parentPath, DefaultName) { }
    public override string Name { get; init; } = DefaultName;

    /// <summary>
    ///     Creates a JSON reader/writer for state files.
    ///     Creates default silently if file doesn't exist. Full read/write with schema.
    /// </summary>
    public JsonReadWriter<T> Json<T>() where T : class, new() =>
        new ComposableJson<T>(this.GetJsonPath(), this.DirectoryPath, JsonBehavior.State);

    /// <summary>
    ///     Creates a JSON reader/writer for state files.
    ///     Creates default silently if file doesn't exist. Full read/write with schema.
    /// </summary>
    public JsonReadWriter<T> Json<T>(string filename) where T : class, new() =>
        new ComposableJson<T>(this.GetJsonPath(filename), this.DirectoryPath, JsonBehavior.State);

    public CsvReadWriter<T> Csv<T>() where T : class, new() =>
        new Csv<T>(this.GetCsvPath());

    public CsvReadWriter<T> Csv<T>(string filename) where T : class, new() =>
        new Csv<T>(this.GetCsvPath(filename));
}

public class OutputManager : BaseLocalManager {
    public OutputManager(string parentPath) : base(parentPath, "output") { }
    private OutputManager(string parentPath, string subDirName) : base(parentPath, subDirName) { }
    public override string Name { get; init; } = "output";

    /// <summary>
    ///     Creates a JSON writer for an output file. Automatically adds .json extension if not present.
    ///     Write-only, no schema injection.
    /// </summary>
    public JsonWriter<object> Json(string filename) =>
        new ComposableJson<object>(this.GetJsonPath(filename), this.DirectoryPath, JsonBehavior.Output);

    /// <summary>
    ///     Creates a JSON writer for output files with timestamp in filename.
    ///     Write-only, no schema injection.
    /// </summary>
    public JsonWriter<object> JsonDated(string filename) =>
        new ComposableJson<object>(this.GetDatedJsonPath(filename), this.DirectoryPath, JsonBehavior.Output);

    public CsvWriter<object> Csv(string filename) =>
        new Csv<object>(this.GetCsvPath(filename));

    public CsvWriter<object> CsvDated(string filename) =>
        new Csv<object>(this.GetDatedCsvPath(filename));

    /// <summary>
    ///     Navigate to a subdirectory for accessing files within nested folders.
    ///     Supports multi-level nesting via chaining or path strings (e.g., "reports/2024").
    /// </summary>
    public OutputManager SubDir(string subdirectory) {
        var subdirectoryPath = Path.Combine(this.DirectoryPath, subdirectory);
        if (Path.GetFullPath(subdirectoryPath).StartsWith(Path.GetFullPath(this.DirectoryPath)))
            return new OutputManager(this.DirectoryPath, subdirectory);

        throw new ArgumentException($"Subdirectory path '{subdirectory}' would escape base directory.");
    }

    /// <summary>
    ///     Creates a timestamped subdirectory for organizing output from a single run.
    ///     Useful for incremental output where multiple files need to be grouped together.
    /// </summary>
    /// <param name="prefix">Optional prefix for the timestamped directory (e.g., "run", "batch")</param>
    /// <returns>OutputManager scoped to the timestamped subdirectory</returns>
    public OutputManager TimestampedSubDir(string? prefix = null) {
        var timestamp = DateTime.Now.ToString("yyyy-MM-dd_HH-mm-ss");
        var dirName = string.IsNullOrWhiteSpace(prefix) ? timestamp : $"{prefix}_{timestamp}";
        return this.SubDir(dirName);
    }
}