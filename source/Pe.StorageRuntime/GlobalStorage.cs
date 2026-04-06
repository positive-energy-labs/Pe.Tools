using Pe.StorageRuntime.Json;

namespace Pe.StorageRuntime;

public sealed class GlobalStorage(string basePath) {
    public string DirectoryPath { get; } = EnsureDirectory(
        SettingsStorageLocations.ResolveModuleDirectory(basePath, "Global")
    );

    public StateStorage State() => new(this.DirectoryPath);

    public OutputStorage Output() => new(this.DirectoryPath);

    public GlobalLogStorage Log() => new(this.DirectoryPath);

    public JsonReadWriter<T> Settings<T>(string filename = "settings") where T : class, new() =>
        new LocalDiskJsonFile<T>(Path.Combine(this.DirectoryPath, StorageFileUtils.EnsureExtension(filename, ".json")));

    public string ResolveGlobalFragmentPath(string relativePath) {
        var fragmentsDirectoryPath = SettingsPathing.ResolveSafeSubDirectoryPath(
            this.DirectoryPath,
            "fragments",
            "fragments"
        );
        _ = Directory.CreateDirectory(fragmentsDirectoryPath);
        return SettingsPathing.ResolveSafeRelativeJsonPath(fragmentsDirectoryPath, relativePath, nameof(relativePath));
    }

    private static string EnsureDirectory(string directoryPath) {
        _ = Directory.CreateDirectory(directoryPath);
        return directoryPath;
    }
}
