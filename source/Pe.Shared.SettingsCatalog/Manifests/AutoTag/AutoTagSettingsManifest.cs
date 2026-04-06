using Pe.Shared.StorageRuntime.Capabilities;
using Pe.Shared.StorageRuntime.Modules;
using Pe.Shared.StorageRuntime.Validation;

namespace Pe.Shared.SettingsCatalog.Manifests.AutoTag;

public static class AutoTagSettingsManifest {
    public static SettingsModuleManifest<AutoTagSettings> Module { get; } = new(
        "AutoTag",
        "autotag",
        SettingsStorageModuleOptions.Empty,
        storageDefinitionFactory: CreateStorageDefinition
    );

    public static SettingsStorageModuleDefinition CreateStorageDefinition(
        SettingsRuntimeMode runtimeMode
    ) => SettingsStorageModuleDefinition.CreateSingleRoot(
        Module.DefaultRootKey,
        Module.StorageOptions,
        new SchemaBackedSettingsDocumentValidator(Module.SettingsType, runtimeMode)
    );
}
