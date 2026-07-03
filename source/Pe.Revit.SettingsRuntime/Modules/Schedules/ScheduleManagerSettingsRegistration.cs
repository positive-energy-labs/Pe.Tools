using Pe.Shared.RevitData.Schedules;
using Pe.Shared.StorageRuntime.Documents;
using Pe.Shared.StorageRuntime.Modules;

namespace Pe.Revit.SettingsRuntime.Modules.Schedules;

public static class ScheduleManagerSettingsRegistration {
    public const string ModuleKey = "CmdScheduleManager";

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
            RootKeys.Schedules
        );

    public static ISettingsRootBinding<BatchScheduleSettings> Batch { get; } =
        new SettingsRootBinding<BatchScheduleSettings>(
            Module,
            RootKeys.Batch
        );

    public static IReadOnlyList<StructuralSettingsModuleDescriptor> StructuralModules { get; } = [Module];
    public static IReadOnlyList<ISettingsRootBinding> RootBindings { get; } = [Profiles, Batch];

    public static class RootKeys {
        public const string Schedules = "schedules";
        public const string Batch = "batch";
    }

}
