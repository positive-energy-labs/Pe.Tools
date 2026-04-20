using Pe.Shared.StorageRuntime.Capabilities;
using Pe.Shared.StorageRuntime.Modules;

namespace Pe.Shared.StorageRuntime;

public interface IStorageModule<TSettings> where TSettings : class {
    string ModuleKey { get; }
    string DefaultRootKey { get; }
    Type SettingsType { get; }
    SettingsStorageModuleOptions StorageOptions { get; }

    SettingsStorageModuleDefinition CreateStorageDefinition(SettingsRuntimeMode runtimeMode);
}

public sealed class ModuleStorage(string moduleKey, string basePath) {
    public string ModuleKey { get; } = NormalizeModuleKey(moduleKey);

    public string BasePath { get; } = NormalizeBasePath(basePath);

    public string DirectoryPath => SettingsStorageLocations.ResolveModuleDirectory(this.BasePath, this.ModuleKey);

    public StateStorage State() => new(this.DirectoryPath);

    public OutputStorage Output() => new(this.DirectoryPath);

    private static string NormalizeModuleKey(string moduleKey) {
        if (string.IsNullOrWhiteSpace(moduleKey))
            throw new ArgumentException("Module key is required.", nameof(moduleKey));

        return moduleKey;
    }

    private static string NormalizeBasePath(string basePath) {
        if (string.IsNullOrWhiteSpace(basePath))
            throw new ArgumentException("Base path is required.", nameof(basePath));

        return Path.GetFullPath(basePath);
    }
}

public sealed class ModuleStorage<TSettings> where TSettings : class {
    private readonly ModuleDocumentStorage _documents;
    private readonly ModuleStorage _moduleStorage;

    public ModuleStorage(
        string moduleKey,
        string defaultRootKey,
        SettingsStorageModuleOptions storageOptions,
        Type settingsType,
        SettingsRuntimeMode runtimeMode = SettingsRuntimeMode.HostOnly,
        string? basePath = null,
        IReadOnlyDictionary<string, SettingsStorageModuleDefinition>? moduleDefinitionsByModuleKey = null
    ) {
        var resolvedBasePath = string.IsNullOrWhiteSpace(basePath)
            ? StorageClient.BasePath
            : Path.GetFullPath(basePath);
        this._moduleStorage = new ModuleStorage(moduleKey, resolvedBasePath);
        this._documents = new ModuleDocumentStorage(
            moduleKey,
            defaultRootKey,
            storageOptions,
            settingsType,
            runtimeMode,
            resolvedBasePath,
            moduleDefinitionsByModuleKey
        );
    }

    public string ModuleKey => this._moduleStorage.ModuleKey;

    public string BasePath => this._moduleStorage.BasePath;

    public ModuleDocumentStorage Documents() => this._documents;

    public StateStorage State() => this._moduleStorage.State();

    public OutputStorage Output() => this._moduleStorage.Output();
}