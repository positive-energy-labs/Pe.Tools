using Pe.Shared.StorageRuntime.AutoTag;
using Pe.Shared.StorageRuntime.Capabilities;
using Pe.Shared.StorageRuntime.Documents;

namespace Pe.Shared.StorageRuntime.Modules;

public static class StorageRuntimeSettingsModules {
    public static SettingsModuleManifest<object> GlobalFragments { get; } = new(
        "Global",
        "fragments",
        SettingsStorageProfiles.SharedAuthoring,
        [new SettingsRootDescriptor("fragments", "fragments")],
        hostScope: SettingsModuleHostScope.Host
    );

    public static IReadOnlyList<ISettingsModuleManifest> All { get; } = [
        AutoTagSettingsManifest.Module,
        GlobalFragments
    ];
}
