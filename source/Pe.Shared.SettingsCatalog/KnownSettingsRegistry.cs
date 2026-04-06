using Pe.Shared.SettingsCatalog.Manifests;
using Pe.Shared.SettingsCatalog.Manifests.AutoTag;
using Pe.Shared.SettingsCatalog.Manifests.FamilyFoundry;
using Pe.Shared.StorageRuntime.Capabilities;
using Pe.Shared.StorageRuntime.Documents;
using Pe.Shared.StorageRuntime.Modules;

namespace Pe.Shared.SettingsCatalog;

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
