namespace Pe.StorageRuntime.Modules;

public class SettingsModuleRegistry {
    private readonly Dictionary<string, ISettingsModule> _modules = new(StringComparer.OrdinalIgnoreCase);

    public void Register(ISettingsModule module) {
        if (this._modules.TryGetValue(module.ModuleKey, out var existing)) {
            if (existing.SettingsType != module.SettingsType) {
                throw new InvalidOperationException(
                    $"Module '{module.ModuleKey}' is already registered with a different settings contract."
                );
            }

            return;
        }

        this._modules[module.ModuleKey] = module;
    }

    public void Register<TModule>() where TModule : ISettingsModule, new() => this.Register(new TModule());

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
