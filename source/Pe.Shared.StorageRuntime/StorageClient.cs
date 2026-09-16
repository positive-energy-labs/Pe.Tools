namespace Pe.Shared.StorageRuntime;

public sealed class StorageClient {
    public static StorageClient Default { get; } = new();

    public ModuleStorage Module(string moduleKey) => new(moduleKey);

    public GlobalStorage Global() => new();
}
