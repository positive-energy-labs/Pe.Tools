using Pe.Revit.SettingsRuntime.Validation;
using Pe.Shared.StorageRuntime.Capabilities;
using SharedBatchScheduleSettings = Pe.Shared.RevitData.Schedules.BatchScheduleSettings;
using SharedScheduleProfile = Pe.Shared.RevitData.Schedules.ScheduleProfile;

namespace Pe.Revit.SettingsRuntime.Modules.Schedules;

public static class ScheduleManagerSettingsManifest {
    public const string ModuleKey = "Schedule Manager";

    public static SettingsModuleManifest<SharedScheduleProfile> Profiles { get; } = new(
        ModuleKey,
        RootKeys.Schedules,
        SettingsStorageProfiles.SharedAuthoring,
        [
            new SettingsRootDescriptor(RootKeys.Schedules, RootKeys.Schedules),
            new SettingsRootDescriptor(RootKeys.Batch, RootKeys.Batch)
        ],
        CreateProfilesStorageDefinition
    );

    public static SettingsModuleManifest<SharedBatchScheduleSettings> Batch { get; } = new(
        ModuleKey,
        RootKeys.Batch,
        SettingsStorageProfiles.SharedAuthoring,
        storageDefinitionFactory: CreateBatchStorageDefinition
    );

    public static SettingsStorageModuleDefinition CreateProfilesStorageDefinition(
        SettingsRuntimeMode runtimeMode
    ) => new(
        Profiles.DefaultRootKey,
        Profiles.Roots.Select(root => root.RootKey).ToList(),
        Profiles.StorageOptions,
        runtimeMode == SettingsRuntimeMode.LiveDocument
            ? new SchemaBackedSettingsDocumentValidator(Profiles.SettingsType, runtimeMode)
            : null
    );

    public static SettingsStorageModuleDefinition CreateBatchStorageDefinition(
        SettingsRuntimeMode runtimeMode
    ) => SettingsStorageModuleDefinition.CreateSingleRoot(
        Batch.DefaultRootKey,
        Batch.StorageOptions,
        runtimeMode == SettingsRuntimeMode.LiveDocument
            ? new SchemaBackedSettingsDocumentValidator(Batch.SettingsType, runtimeMode)
            : null
    );

    public static class RootKeys {
        public const string Schedules = "schedules";
        public const string Batch = "batch";
    }
}
