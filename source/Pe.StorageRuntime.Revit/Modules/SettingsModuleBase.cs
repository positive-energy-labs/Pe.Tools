using Pe.StorageRuntime.Modules;
using Pe.StorageRuntime.Revit.Core;

namespace Pe.StorageRuntime.Revit.Modules;

public abstract class SettingsModuleBase<TSettings>(string moduleKey, string defaultSubDirectory)
    : ISettingsModule<TSettings>
    where TSettings : class {
    protected SettingsModuleBase(
        string moduleKey,
        string defaultSubDirectory,
        SettingsStorageModuleOptions? storageOptions
    ) : this(moduleKey, defaultSubDirectory) {
        this.StorageOptions = storageOptions ?? SettingsModulePolicyResolver.CreateStorageOptions(typeof(TSettings));
    }

    public string ModuleKey { get; } = moduleKey;
    public string DefaultSubDirectory { get; } = defaultSubDirectory;
    public Type SettingsType => typeof(TSettings);

    public SettingsStorageModuleOptions StorageOptions { get; } =
        SettingsModulePolicyResolver.CreateStorageOptions(typeof(TSettings));

    public virtual SharedModuleSettingsStorage SharedStorage() => new(this);
}
