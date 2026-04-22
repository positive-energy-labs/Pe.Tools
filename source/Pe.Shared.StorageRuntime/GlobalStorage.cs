using Pe.Shared.StorageRuntime.Json;

namespace Pe.Shared.StorageRuntime;

public sealed class GlobalStorage(string basePath) {
    public string DirectoryPath { get; } = EnsureDirectory(
        GlobalStorageLocations.ResolveGlobalDirectory(basePath)
    );

    public StateStorage State() => new(this.DirectoryPath);

    public OutputStorage Output() => new(this.DirectoryPath);

    public GlobalLogStorage Log() => new(this.DirectoryPath);

    public ManagedLogFile HostLog() => this.Log().HostLog();

    public ManagedLogFile RevitAppLog() => this.Log().RevitAppLog();

    public JsonReadWriter<T> Settings<T>(string filename = "settings") where T : class, new() =>
        new LocalDiskJsonFile<T>(Path.Combine(this.DirectoryPath, StorageFileUtils.EnsureExtension(filename, ".json")));

    public string ResolveGlobalFragmentPath(string relativePath) {
        var fragmentsDirectoryPath = GlobalStorageLocations.ResolveFragmentsDirectory(basePath);
        _ = Directory.CreateDirectory(fragmentsDirectoryPath);
        return SettingsPathing.ResolveSafeRelativeJsonPath(fragmentsDirectoryPath, relativePath, nameof(relativePath));
    }

    private static string EnsureDirectory(string directoryPath) {
        _ = Directory.CreateDirectory(directoryPath);
        return directoryPath;
    }
}