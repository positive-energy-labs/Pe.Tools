using Pe.Revit.SettingsRuntime.Modules.AutoTag;

namespace Pe.Revit.SettingsRuntime.Modules;

public static class RevitSettingsRuntimeModules {
    public static IReadOnlyList<ISettingsModuleManifest> All { get; } = [
        AutoTagSettingsManifest.Module
    ];
}