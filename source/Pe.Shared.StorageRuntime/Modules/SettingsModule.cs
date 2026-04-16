using Pe.Shared.StorageRuntime.Capabilities;

namespace Pe.Shared.StorageRuntime.Modules;

public enum SettingsModuleHostScope {
    Host,
    Session,
    ActiveDocument
}

public enum SettingsModuleActiveDocumentKind {
    Any,
    ProjectOnly,
    FamilyOnly
}

public interface ISettingsModule {
    string ModuleKey { get; }
    string DefaultRootKey { get; }
    Type SettingsType { get; }
    SettingsStorageModuleOptions StorageOptions { get; }
    SettingsModuleHostScope HostScope { get; }
    SettingsModuleActiveDocumentKind ActiveDocumentKind { get; }
}

public interface ISettingsModule<TSettings> : ISettingsModule, IStorageModule<TSettings> where TSettings : class;

public abstract class BaseSettingsModule<TSettings>(string moduleKey, string defaultRootKey)
    : ISettingsModule<TSettings>
    where TSettings : class {
    protected BaseSettingsModule(
        string moduleKey,
        string defaultRootKey,
        SettingsStorageModuleOptions? storageOptions
    ) : this(moduleKey, defaultRootKey) =>
        this.StorageOptions = storageOptions ?? SettingsModulePolicyResolver.CreateStorageOptions(typeof(TSettings));

    public string ModuleKey { get; } = moduleKey;
    public string DefaultRootKey { get; } = defaultRootKey;
    public Type SettingsType => typeof(TSettings);

    public SettingsStorageModuleOptions StorageOptions { get; } =
        SettingsModulePolicyResolver.CreateStorageOptions(typeof(TSettings));

    public virtual SettingsModuleHostScope HostScope => SettingsModuleHostScope.Session;
    public virtual SettingsModuleActiveDocumentKind ActiveDocumentKind => SettingsModuleActiveDocumentKind.Any;

    public virtual SettingsStorageModuleDefinition CreateStorageDefinition(SettingsRuntimeMode runtimeMode) =>
        SettingsStorageModuleDefinition.CreateSingleRoot(this.DefaultRootKey, this.StorageOptions);
}
