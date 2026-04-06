using Pe.StorageRuntime.Capabilities;
using Pe.StorageRuntime.Modules;
using Pe.StorageRuntime.Revit.Validation;

namespace Pe.SettingsCatalog.Manifests.AutoTag;

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
