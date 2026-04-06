using Pe.Shared.StorageRuntime.Capabilities;
using Pe.Shared.StorageRuntime.Modules;
using Pe.Shared.StorageRuntime.Validation;

namespace Pe.Shared.SettingsCatalog.Manifests.FamilyFoundry;

public static class FFMigratorManifest {
    public static SettingsModuleManifest<FFMigratorSettings> Module { get; } = new(
        "CmdFFMigrator",
        "profiles",
        SettingsCatalogStorageProfiles.SharedAuthoring,
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
