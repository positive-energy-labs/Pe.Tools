using Pe.Global.Services.Storage.Core.Json;

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
    public string GetJsonPath(string filename = null) {
        var name = filename ?? this.Name;
        var nameWithExt = FileUtils.EnsureExtension(name, ".json");
        return Path.Combine(this.DirectoryPath, nameWithExt);
    }

    /// <summary>
    ///     Get the path to the JSON file with a timestamp in the filename. Uses the <see cref="Name" /> of the manager by
    ///     default. Automatically adds .json extension if not present.
    /// </summary>
    public string GetDatedJsonPath(string filename = null) {
        var name = filename ?? this.Name;
        // Remove .json extension if present, since we'll add it after the timestamp
        if (name.EndsWith(".json", StringComparison.OrdinalIgnoreCase))
            name = name.Substring(0, name.Length - 5);

        var nameWithTimestamp = $"{name}_{DateTime.Now.ToString("yyyy-MM-dd_HH-mm-ss")}";
        var nameWithExt = FileUtils.EnsureExtension(nameWithTimestamp, ".json");
        return Path.Combine(this.DirectoryPath, nameWithExt);
    }

    /// <summary>
    ///     Get the path to the CSV file. Uses the <see cref="Name" /> of the manager by default.
    /// </summary>
    public string GetCsvPath(string filename = null) =>
        Path.Combine(this.DirectoryPath, filename ?? $"{this.Name}.csv");

    /// <summary>
    ///     Get the path to the CSV file with a timestamp in the filename. Uses the <see cref="Name" /> of the manager by
    ///     default.
    /// </summary>
    public string GetDatedCsvPath(string filename = null) =>
        Path.Combine(this.DirectoryPath, $"{filename ?? this.Name}_{DateTime.Now.ToString("yyyy-MM-dd_HH-mm-ss")}.csv");
}

public class SettingsManager : BaseLocalManager {
    private const string DefaultName = "settings";

    public SettingsManager(string parentPath) : base(parentPath, DefaultName) { }
    protected SettingsManager(string parentPath, string subDirName) : base(parentPath, subDirName) { }
    public override string Name { get; init; } = DefaultName;

    /// <summary>
    ///     Creates a JSON reader for settings files. Supports $extends and $include composition.
    ///     Crashes if file doesn't exist (creates default for user review).
    /// </summary>
    public JsonReader<T> Json<T>() where T : class, new() =>
        new ComposableJson<T>(this.GetJsonPath(), this.DirectoryPath, JsonBehavior.Settings);

    /// <summary>
    ///     Creates a JSON reader for settings files. Supports $extends and $include composition.
    ///     Crashes if file doesn't exist (creates default for user review).
    /// </summary>
    public JsonReader<T> Json<T>(string filename) where T : class, new() =>
        new ComposableJson<T>(this.GetJsonPath(filename), this.DirectoryPath, JsonBehavior.Settings);

    /// <summary>
    ///     Navigate to a subdirectory for accessing files within nested folders.
    ///     Supports multi-level nesting via chaining or path strings (e.g., "profiles/production").
    /// </summary>
    /// <param name="subdirectory">The subdirectory path (relative to current directory)</param>
    /// <param name="recursiveDiscovery">Enable recursive file discovery for nested organization</param>
    public SettingsSubDir SubDir(string subdirectory, bool recursiveDiscovery = false) {
        var subdirectoryPath = Path.Combine(this.DirectoryPath, subdirectory);
        if (Path.GetFullPath(subdirectoryPath).StartsWith(Path.GetFullPath(this.DirectoryPath)))
            return new SettingsSubDir(this.DirectoryPath, subdirectory, recursiveDiscovery);

        throw new ArgumentException($"Subdirectory path '{subdirectory}' would escape base directory.");
    }
}

/// <summary>
///     Extended SettingsManager for subdirectories with optional recursive file discovery.
/// </summary>
public class SettingsSubDir : SettingsManager {
    private readonly List<string> _excludePatterns;

    public SettingsSubDir(string parentPath,
        string subDirName,
        bool recursiveDiscovery,
        List<string> excludePatterns = null)
        : base(parentPath, subDirName) {
        this.RecursiveDiscovery = recursiveDiscovery;
        this._excludePatterns = excludePatterns ?? ["_*"]; // Default: exclude _fragments, etc.
    }

    public bool RecursiveDiscovery { get; }

    /// <summary>
    ///     Lists all JSON files in this directory.
    ///     If RecursiveDiscovery is enabled, includes files from all nested subdirectories.
    ///     Returns relative paths from this directory (e.g., "electrical/panel.json").
    ///     Excludes schema files and directories matching exclusion patterns (default: _*).
    /// </summary>
    public List<string> ListJsonFiles() {
        if (!Directory.Exists(this.DirectoryPath))
            return [];

        var searchOption = this.RecursiveDiscovery ? SearchOption.AllDirectories : SearchOption.TopDirectoryOnly;
        var files = Directory.GetFiles(this.DirectoryPath, "*.json", searchOption);

        return files
            .Select(f => Path.GetRelativePath(this.DirectoryPath, f))
            .Where(f => !f.EndsWith("schema.json") && !f.Contains("schema-"))
            .Where(f => !this.MatchesExcludePattern(f))
            .ToList();
    }

    /// <summary>
    ///     Checks if a relative path matches any exclusion pattern.
    /// </summary>
    private bool MatchesExcludePattern(string relativePath) {
        var segments = relativePath.Split(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar);
        return segments.Any(seg => this._excludePatterns.Any(pattern =>
            pattern.EndsWith("*") ? seg.StartsWith(pattern.TrimEnd('*')) : seg == pattern));
    }
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
    public OutputManager TimestampedSubDir(string prefix = null) {
        var timestamp = DateTime.Now.ToString("yyyy-MM-dd_HH-mm-ss");
        var dirName = string.IsNullOrWhiteSpace(prefix) ? timestamp : $"{prefix}_{timestamp}";
        return this.SubDir(dirName);
    }
}