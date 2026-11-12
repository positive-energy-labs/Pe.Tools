using Pe.Shared.Product;

namespace Pe.Shared.StorageRuntime;

/// <summary>Per-command runtime state and output folders, named by the command's module.</summary>
public sealed class ModuleStorage(string module) {
    public string ModuleKey { get; } = string.IsNullOrWhiteSpace(module)
        ? throw new ArgumentException("Module is required.", nameof(module))
        : module;

    public StateStorage State() => StateStorage.ExactDir(
        ProductRuntimeLayout.Current.State.ResolveModuleStatePath(this.ModuleKey)
    );

    /// <summary>Files a pod-less command writes for a person to open: machine state, never a content home (ADR 0037 rule 6).</summary>
    public OutputStorage Output() => new(
        ProductRuntimeLayout.Current.State.ModuleOutputPath,
        this.ModuleKey
    );
}
