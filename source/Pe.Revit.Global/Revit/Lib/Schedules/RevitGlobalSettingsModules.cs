using Pe.Shared.StorageRuntime.Modules;

namespace Pe.Revit.Global.Revit.Lib.Schedules;

public static class RevitGlobalSettingsModules {
    public static IReadOnlyList<ISettingsModuleManifest> All { get; } = [
        ScheduleManagerSettingsManifest.Profiles
    ];
}