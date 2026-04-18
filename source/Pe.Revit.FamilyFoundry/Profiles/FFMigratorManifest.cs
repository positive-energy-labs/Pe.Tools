using Pe.Shared.StorageRuntime.Capabilities;
using Pe.Shared.StorageRuntime.Modules;
using Pe.Shared.StorageRuntime.Validation;

namespace Pe.Revit.FamilyFoundry.Profiles;

public static class FFMigratorManifest {
    public static SettingsModuleManifest<FFMigratorProfile> Module { get; } = new(
        "CmdFFMigrator",
        "profiles",
        SettingsStorageProfiles.SharedAuthoring,
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
