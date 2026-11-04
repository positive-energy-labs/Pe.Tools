using Pe.Shared.Product;
using Pe.Shared.StorageRuntime;
using Pe.Shared.StorageRuntime.Json;

namespace Pe.Shared.StorageRuntime;

public sealed class GlobalStorage {
    public string DirectoryPath { get; } = ProductRuntimeLayout.Current.State.GlobalStatePath;

    public StateStorage State() => StateStorage.ExactDir(
        ProductRuntimeLayout.Current.State.GlobalStatePath
    );

    public GlobalLogStorage Log() => new(ProductRuntimeLayout.Current.Logs.RootPath);

    public ManagedLogFile RevitAppLog() => this.Log().RevitAppLog();

}
