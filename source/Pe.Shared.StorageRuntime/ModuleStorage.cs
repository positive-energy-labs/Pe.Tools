using Pe.Shared.Product;

namespace Pe.Shared.StorageRuntime;

/// <summary>Per-command runtime state and output folders, named by the command's module.</summary>
public sealed class ModuleStorage(string module) {
    public string ModuleKey { get; } = string.IsNullOrWhiteSpace(module)
        ? throw new ArgumentException("Module is required.", nameof(module))
        : module;

    public StateStorage State() => StateStorage.ExactDir(
        ProductRuntimeLayout.ForCurrentUser().State.ResolveModuleStatePath(this.ModuleKey)
    );

    public OutputStorage Output() => new(
        ProductUserContentLayout.ForCurrentUser().Output.RootPath,
        this.ModuleKey
    );
}
