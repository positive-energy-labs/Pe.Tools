using Pe.Revit.SettingsRuntime.Validation;
using Pe.Shared.RevitData.Schedules;
using Pe.Shared.StorageRuntime.Capabilities;
using Pe.Shared.StorageRuntime.Documents;
using Pe.Shared.StorageRuntime.Modules;

namespace Pe.Revit.SettingsRuntime.Modules.Schedules;

public static class ScheduleManagerSettingsRegistration {
    public const string ModuleKey = "Schedule Manager";

    public static StructuralSettingsModuleDescriptor Module { get; } = new(
        ModuleKey,
        RootKeys.Schedules,
        [
            new SettingsRootDescriptor(RootKeys.Schedules, RootKeys.Schedules),
            new SettingsRootDescriptor(RootKeys.Batch, RootKeys.Batch)
        ],
        SettingsStorageProfiles.SharedAuthoring,
        SettingsModuleHostScope.Session,
        SettingsModuleActiveDocumentKind.Any
    );

    public static ISettingsRootBinding<ScheduleProfile> Profiles { get; } =
        new SettingsRootBinding<ScheduleProfile>(
            Module,
            RootKeys.Schedules,
            CreateProfileValidator
        );

    public static ISettingsRootBinding<BatchScheduleSettings> Batch { get; } =
        new SettingsRootBinding<BatchScheduleSettings>(
            Module,
            RootKeys.Batch,
            CreateBatchValidator
        );

    public static IReadOnlyList<StructuralSettingsModuleDescriptor> StructuralModules { get; } = [Module];
    public static IReadOnlyList<ISettingsRootBinding> RootBindings { get; } = [Profiles, Batch];

    public static class RootKeys {
        public const string Schedules = "schedules";
        public const string Batch = "batch";
    }

    private static ISettingsDocumentValidator? CreateProfileValidator(SettingsRuntimeMode runtimeMode) =>
        runtimeMode == SettingsRuntimeMode.LiveDocument
            ? new SchemaBackedSettingsDocumentValidator(typeof(ScheduleProfile), runtimeMode)
            : null;

    private static ISettingsDocumentValidator? CreateBatchValidator(SettingsRuntimeMode runtimeMode) =>
        runtimeMode == SettingsRuntimeMode.LiveDocument
            ? new SchemaBackedSettingsDocumentValidator(typeof(BatchScheduleSettings), runtimeMode)
            : null;
}
