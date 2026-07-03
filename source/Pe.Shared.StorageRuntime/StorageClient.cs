using Pe.Shared.StorageRuntime.Capabilities;
using Pe.Shared.StorageRuntime.Modules;

namespace Pe.Shared.StorageRuntime;

public sealed class StorageClient {
    private readonly string _basePath;

    public StorageClient() : this(BasePath) { }

    private StorageClient(string basePath) =>
        this._basePath = string.IsNullOrWhiteSpace(basePath)
            ? throw new ArgumentException("Base path is required.", nameof(basePath))
            : Path.GetFullPath(basePath);

    public static StorageClient Default { get; } = new();

    public static string BasePath => SettingsStorageLocations.GetDefaultBasePath();

    public ModuleStorage Module(string moduleKey) => new(moduleKey, this._basePath);

    public ModuleStorage<TSettings> Root<TSettings>(ISettingsRootBinding<TSettings> binding) where TSettings : class {
        if (binding == null)
            throw new ArgumentNullException(nameof(binding));

        return new ModuleStorage<TSettings>(
            binding.Module.ModuleKey,
            binding.RootKey,
            binding.Module.StorageOptions,
            SettingsRuntimeMode.LiveDocument,
            this._basePath
        );
    }

    public ModuleStorage<TSettings> Module<TSettings>(IStorageModule<TSettings> module) where TSettings : class {
        if (module == null)
            throw new ArgumentNullException(nameof(module));

        return new ModuleStorage<TSettings>(
            module.ModuleKey,
            module.DefaultRootKey,
            module.StorageOptions,
            SettingsRuntimeMode.LiveDocument,
            this._basePath
        );
    }

    public GlobalStorage Global() => new(this._basePath);
}
