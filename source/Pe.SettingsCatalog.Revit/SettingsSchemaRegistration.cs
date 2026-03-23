using Pe.SettingsCatalog;
using Pe.StorageRuntime.Documents;
using Pe.StorageRuntime.Modules;

namespace Pe.SettingsCatalog.Revit;

public sealed class SettingsSchemaRegistration(
    SettingsCatalogModule catalogModule,
    Type settingsType,
    IReadOnlyList<SettingsRootDescriptor>? roots = null) : ISettingsModuleDescriptor {
    public SettingsCatalogModule CatalogModule { get; } = catalogModule;
    public Type SettingsType { get; } = settingsType;

    public IReadOnlyList<SettingsRootDescriptor> Roots { get; } =
        roots ?? [new SettingsRootDescriptor(catalogModule.DefaultRootKey, catalogModule.DefaultRootKey)];

    public string ModuleKey => this.CatalogModule.ModuleKey;
    public string DefaultRootKey => this.CatalogModule.DefaultRootKey;
    public string DefaultSubDirectory => this.DefaultRootKey;
    public SettingsStorageModuleOptions StorageOptions => this.CatalogModule.StorageOptions;
}
