namespace Pe.Revit.SettingsRuntime.Modules.Schedules;

public static class RevitGlobalSettingsModules {
    public static IReadOnlyList<ISettingsModuleManifest> All { get; } = [
        ScheduleManagerSettingsManifest.Profiles
    ];
}
