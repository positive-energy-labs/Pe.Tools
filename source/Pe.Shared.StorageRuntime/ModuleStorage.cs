using Pe.Shared.Product;

namespace Pe.Shared.StorageRuntime;

public sealed class ModuleStorage(string moduleKey) {
    public string ModuleKey { get; } = NormalizeModuleKey(moduleKey);

    public StateStorage State() => StateStorage.ExactDir(
        ProductRuntimeLayout.ForCurrentUser().State.ResolveModuleStatePath(this.ModuleKey)
    );

    public OutputStorage Output() => new(
        ProductUserContentLayout.ForCurrentUser().Output.RootPath,
        this.ModuleKey
    );

    private static string NormalizeModuleKey(string moduleKey) {
        if (string.IsNullOrWhiteSpace(moduleKey))
            throw new ArgumentException("Module key is required.", nameof(moduleKey));

        return moduleKey;
    }
}
