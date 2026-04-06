using Pe.StorageRuntime.Capabilities;
using Pe.StorageRuntime.Modules;
using Pe.StorageRuntime.Revit.Validation;

namespace Pe.SettingsCatalog.Manifests.FamilyFoundry;

public static class ProfileRemapSettingsManifest {
    public static SettingsModuleManifest<ProfileRemap> Module { get; } = new(
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
