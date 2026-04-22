using Pe.Revit.SettingsRuntime.Validation;
using Pe.Shared.StorageRuntime.Capabilities;

namespace Pe.Revit.SettingsRuntime.Modules.AutoTag;

public static class AutoTagSettingsManifest {
    public static SettingsModuleManifest<AutoTagSettings> Module { get; } = new(
        "AutoTag",
        "autotag",
        SettingsStorageModuleOptions.Empty,
        storageDefinitionFactory: CreateStorageDefinition,
        hostScope: SettingsModuleHostScope.ActiveDocument,
        activeDocumentKind: SettingsModuleActiveDocumentKind.ProjectOnly
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