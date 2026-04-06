using Pe.SettingsCatalog.Manifests.AutoTag;
using Pe.SettingsCatalog.Manifests.FamilyFoundry;
using Pe.StorageRuntime.Capabilities;
using Pe.StorageRuntime.Documents;
using Pe.StorageRuntime.Modules;

namespace Pe.SettingsCatalog;

public static class KnownSettingsRegistry {
    public static SettingsModuleManifest<object> GlobalFragments { get; } = new(
        "Global",
        "fragments",
        SettingsCatalogStorageProfiles.SharedAuthoring,
        [new SettingsRootDescriptor("fragments", "fragments")]
    );

    public static IReadOnlyList<ISettingsModuleManifest> All { get; } = [
        AutoTagSettingsManifest.Module,
        ProfileFamilyManagerSettingsManifest.Module,
        ProfileRemapSettingsManifest.Module,
        GlobalFragments
    ];

    public static void RegisterRevitModules(SettingsModuleRegistry registry) {
        foreach (var module in All.Where(module => module.SettingsType != typeof(object)))
            registry.Register(module);
    }
}
