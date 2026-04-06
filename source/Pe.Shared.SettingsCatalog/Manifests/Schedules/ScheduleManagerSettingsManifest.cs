using Pe.Revit.Global.Revit.Lib.Schedules;
using Pe.Shared.StorageRuntime.Capabilities;
using Pe.Shared.StorageRuntime.Documents;
using Pe.Shared.StorageRuntime.Modules;
using Pe.Shared.StorageRuntime.Validation;

namespace Pe.Shared.SettingsCatalog.Manifests.Schedules;

public static class ScheduleManagerSettingsManifest {
    public const string ModuleKey = "Schedule Manager";

    public static SettingsModuleManifest<ScheduleSpec> Profiles { get; } = new(
        ModuleKey,
        RootKeys.Schedules,
        SettingsCatalogStorageProfiles.SharedAuthoring,
        roots: [
            new SettingsRootDescriptor(RootKeys.Schedules, RootKeys.Schedules),
            new SettingsRootDescriptor(RootKeys.Batch, RootKeys.Batch)
        ],
        storageDefinitionFactory: CreateProfilesStorageDefinition
    );

    public static SettingsModuleManifest<BatchScheduleSettings> Batch { get; } = new(
        ModuleKey,
        RootKeys.Batch,
        SettingsCatalogStorageProfiles.SharedAuthoring
    );

    public static SettingsStorageModuleDefinition CreateProfilesStorageDefinition(
        SettingsRuntimeMode runtimeMode
    ) => new(
        Profiles.DefaultRootKey,
        Profiles.Roots.Select(root => root.RootKey).ToList(),
        Profiles.StorageOptions,
        new SchemaBackedSettingsDocumentValidator(Profiles.SettingsType, runtimeMode)
    );

    public static SettingsStorageModuleDefinition CreateBatchStorageDefinition(
        SettingsRuntimeMode runtimeMode
    ) => SettingsStorageModuleDefinition.CreateSingleRoot(
        Batch.DefaultRootKey,
        Batch.StorageOptions,
        new SchemaBackedSettingsDocumentValidator(Batch.SettingsType, runtimeMode)
    );

    public static class RootKeys {
        public const string Schedules = "schedules";
        public const string Batch = "batch";
    }
}
