using Pe.Shared.StorageRuntime.Modules;

namespace Pe.Revit.Global.Revit.Documents.Schedules;

public static class RevitGlobalSettingsModules {
    public static IReadOnlyList<ISettingsModuleManifest> All { get; } = [
        ScheduleManagerSettingsManifest.Profiles
    ];
}
