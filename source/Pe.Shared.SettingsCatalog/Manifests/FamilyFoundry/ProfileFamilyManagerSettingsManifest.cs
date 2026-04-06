using Pe.Shared.StorageRuntime.Capabilities;
using Pe.Shared.StorageRuntime.Modules;
using Pe.Shared.StorageRuntime.Validation;

namespace Pe.Shared.SettingsCatalog.Manifests.FamilyFoundry;

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
