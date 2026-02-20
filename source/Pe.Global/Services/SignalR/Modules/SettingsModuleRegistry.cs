namespace Pe.Global.Services.SignalR.Modules;

/// <summary>
///     Registry for SignalR settings modules.
/// </summary>
public class SettingsModuleRegistry {
    private readonly Dictionary<string, ISettingsModule> _modules = new(StringComparer.OrdinalIgnoreCase);

    /// <summary>
    ///     Register a module instance.
    /// </summary>
    public void Register(ISettingsModule module) {
        if (this._modules.TryGetValue(module.ModuleKey, out var existing)) {
            if (existing.SettingsType != module.SettingsType ||
                !existing.SettingsTypeName.Equals(module.SettingsTypeName, StringComparison.OrdinalIgnoreCase))
                throw new InvalidOperationException(
                    $"Module '{module.ModuleKey}' is already registered with a different settings contract.");

            return;
        }

        this._modules[module.ModuleKey] = module;
    }

    /// <summary>
    ///     Register a module by type.
    /// </summary>
    public void Register<TModule>() where TModule : ISettingsModule, new() => this.Register(new TModule());

    /// <summary>
    ///     Get all registered modules.
    /// </summary>
    public IEnumerable<ISettingsModule> GetModules() => this._modules.Values;

    public bool TryResolveByModuleKey(string moduleKey, out ISettingsModule module) =>
        this._modules.TryGetValue(moduleKey, out module!);

    public ISettingsModule ResolveByModuleKey(string moduleKey) =>
        this.TryResolveByModuleKey(moduleKey, out var module)
            ? module
            : throw new ArgumentException(
                $"Unknown module: {moduleKey}. Available modules: {string.Join(", ", this._modules.Keys)}"
            );
}
