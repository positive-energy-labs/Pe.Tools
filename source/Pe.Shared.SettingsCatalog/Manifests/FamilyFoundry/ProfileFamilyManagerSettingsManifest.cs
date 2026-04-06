using Pe.StorageRuntime.Capabilities;
using Pe.StorageRuntime.Modules;
using Pe.StorageRuntime.Revit.Validation;

namespace Pe.SettingsCatalog.Manifests.FamilyFoundry;

public static class ProfileFamilyManagerSettingsManifest {
    public static SettingsModuleManifest<ProfileFamilyManager> Module { get; } = new(
        "CmdFFManager",
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
