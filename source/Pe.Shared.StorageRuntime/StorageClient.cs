using Pe.Shared.StorageRuntime.Capabilities;
using Pe.Shared.StorageRuntime.Modules;

namespace Pe.Shared.StorageRuntime;

public sealed class StorageClient {
    private readonly IStorageSource _source;

    public StorageClient() : this(new LocalDiskStorageSource(BasePath)) { }

    internal StorageClient(IStorageSource source) =>
        this._source = source ?? throw new ArgumentNullException(nameof(source));

    public static StorageClient Default { get; } = new();

    public static string BasePath => SettingsStorageLocations.GetDefaultBasePath();

    public ModuleStorage Module(string moduleKey) => this._source.CreateModule(moduleKey);

    public ModuleStorage<TSettings> Module<TSettings>(IStorageModule<TSettings> module) where TSettings : class {
        if (module == null)
            throw new ArgumentNullException(nameof(module));

        return new ModuleStorage<TSettings>(
            module.ModuleKey,
            module.DefaultRootKey,
            module.StorageOptions,
            module.SettingsType,
            SettingsRuntimeMode.LiveDocument,
            BasePath,
            new Dictionary<string, SettingsStorageModuleDefinition>(StringComparer.OrdinalIgnoreCase) {
                [module.ModuleKey] = module.CreateStorageDefinition(SettingsRuntimeMode.LiveDocument)
            }
        );
    }

    public GlobalStorage Global() => this._source.CreateGlobal();
}

internal interface IStorageSource {
    ModuleStorage CreateModule(string moduleKey);
    GlobalStorage CreateGlobal();
}

internal sealed class LocalDiskStorageSource(string basePath) : IStorageSource {
    private readonly string _basePath = string.IsNullOrWhiteSpace(basePath)
        ? throw new ArgumentException("Base path is required.", nameof(basePath))
        : Path.GetFullPath(basePath);

    public ModuleStorage CreateModule(string moduleKey) => new(moduleKey, this._basePath);

    public GlobalStorage CreateGlobal() => new(this._basePath);
}