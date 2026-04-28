using Pe.Revit.SettingsRuntime.Modules.AutoTag;
using Pe.Revit.SettingsRuntime.Modules.Schedules;
using Pe.Shared.StorageRuntime.Modules;

namespace Pe.Revit.SettingsRuntime.Modules;

public static class RevitSettingsRuntimeRegistration {
    public static IReadOnlyList<StructuralSettingsModuleDescriptor> StructuralModules { get; } = [
        .. AutoTagSettingsRegistration.StructuralModules,
        .. ScheduleManagerSettingsRegistration.StructuralModules
    ];

    public static IReadOnlyList<ISettingsRootBinding> RootBindings { get; } = [
        .. AutoTagSettingsRegistration.RootBindings,
        .. ScheduleManagerSettingsRegistration.RootBindings
    ];
}
