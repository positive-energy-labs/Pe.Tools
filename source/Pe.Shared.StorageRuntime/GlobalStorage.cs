using Pe.Shared.Product;
using Pe.Shared.StorageRuntime;
using Pe.Shared.StorageRuntime.Json;

namespace Pe.Shared.StorageRuntime;

public sealed class GlobalStorage {
    public string DirectoryPath { get; } = ProductRuntimeLayout.ForCurrentUser().State.GlobalStatePath;

    public StateStorage State() => StateStorage.ExactDir(
        ProductRuntimeLayout.ForCurrentUser().State.GlobalStatePath
    );

    public OutputStorage Output() => OutputStorage.ExactDir(
        ProductUserContentLayout.ForCurrentUser().Output.GlobalOutputPath
    );

    public GlobalLogStorage Log() => new(ProductRuntimeLayout.ForCurrentUser().Logs.RootPath);

    public ManagedLogFile RevitAppLog() => this.Log().RevitAppLog();

}
