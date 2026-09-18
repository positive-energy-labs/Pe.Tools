namespace Pe.Shared.StorageRuntime;

public sealed class StorageClient {
    public static StorageClient Default { get; } = new();

    public ModuleStorage Module(string module) => new(module);

    public GlobalStorage Global() => new();
}
