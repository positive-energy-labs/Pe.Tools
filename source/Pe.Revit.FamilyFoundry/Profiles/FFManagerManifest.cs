using Pe.Revit.SettingsRuntime.Validation;
using Pe.Shared.StorageRuntime.Capabilities;
using Pe.Shared.StorageRuntime.Modules;

namespace Pe.Revit.FamilyFoundry.Profiles;

public static class FFManagerManifest {
    public static SettingsModuleManifest<FFManagerProfile> Module { get; } = new(
        "CmdFFManager",
        "profiles",
        SettingsStorageProfiles.SharedAuthoring,
        storageDefinitionFactory: CreateStorageDefinition
    );

    public static SettingsStorageModuleDefinition CreateStorageDefinition(
        SettingsRuntimeMode runtimeMode
    ) => SettingsStorageModuleDefinition.CreateSingleRoot(
        Module.DefaultRootKey,
        Module.StorageOptions,
        runtimeMode == SettingsRuntimeMode.LiveDocument
            ? new SchemaBackedSettingsDocumentValidator(Module.SettingsType, runtimeMode)
            : null
    );
}