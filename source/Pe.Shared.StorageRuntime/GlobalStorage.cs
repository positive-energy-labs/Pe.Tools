using Pe.Shared.Product;
using Pe.Shared.StorageRuntime;
using Pe.Shared.StorageRuntime.Json;

namespace Pe.Shared.StorageRuntime;

public sealed class GlobalStorage(string basePath) {
    public string DirectoryPath { get; } = EnsureDirectory(
        GlobalStorageLocations.ResolveGlobalDirectory(basePath)
    );

    public StateStorage State() => StateStorage.ExactDir(
        ProductRuntimeLayout.ForCurrentUser().State.GlobalStatePath,
        Path.Combine(this.DirectoryPath, "state")
    );

    public OutputStorage Output() => OutputStorage.ExactDir(
        ProductUserContentLayout.ForCurrentUser().Output.GlobalOutputPath
    );

    public GlobalLogStorage Log() => new(ProductRuntimeLayout.ForCurrentUser().Logs.RootPath);

    public ManagedLogFile RevitAppLog() => this.Log().RevitAppLog();

    public JsonReadWriter<T> Settings<T>(string filename = "settings") where T : class, new() =>
        new LocalDiskJsonFile<T>(Path.Combine(this.DirectoryPath, StorageFileUtils.EnsureExtension(filename, ".json")));

    private static string EnsureDirectory(string directoryPath) {
        _ = Directory.CreateDirectory(directoryPath);
        return directoryPath;
    }
}
