using Pe.StorageRuntime.Capabilities;
using Pe.StorageRuntime.Revit.Modules;

namespace Pe.SettingsCatalog.Revit;

public sealed class CatalogSettingsModule<TSettings> : SettingsModuleBase<TSettings>
    where TSettings : class {
    public CatalogSettingsModule(SettingsSchemaRegistration schema)
        : base(schema.ModuleKey, schema.DefaultRootKey) {
        if (schema.SettingsType != typeof(TSettings)) {
            throw new InvalidOperationException(
                $"Schema '{schema.ModuleKey}' is registered for '{schema.SettingsType.FullName}', not '{typeof(TSettings).FullName}'."
            );
        }
    }

    public override SharedModuleSettingsStorage SharedStorage() => new(
        this,
        SettingsCapabilityTier.RevitAssembly,
        KnownSettingsStorageDefinitions.Create(SettingsCapabilityTier.RevitAssembly)
    );
}
