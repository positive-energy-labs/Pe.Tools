using Pe.Revit.FamilyFoundry.Profiles;
using Pe.Shared.SettingsCatalog.Manifests;
using Pe.Shared.StorageRuntime.Modules;

namespace Pe.Revit.FamilyFoundry;

public static class FamilyFoundrySettingsRegistry {
    public static IReadOnlyList<ISettingsModuleManifest> All { get; } = [
        FFManagerManifest.Module,
        FFMigratorManifest.Module
    ];

    public static void RegisterRevitModules(SettingsModuleRegistry registry) {
        foreach (var module in All.Where(module => module.HostScope != SettingsModuleHostScope.Host &&
                                                   module.SettingsType != typeof(object)))
            registry.Register(module);
    }
}
