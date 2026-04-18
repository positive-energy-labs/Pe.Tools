using Pe.Revit.FamilyFoundry.Profiles;
using Pe.Shared.StorageRuntime.Modules;

namespace Pe.Revit.FamilyFoundry;

public static class FamilyFoundrySettingsModules {
    public static IReadOnlyList<ISettingsModuleManifest> All { get; } = [
        FFManagerManifest.Module,
        FFMigratorManifest.Module
    ];
}
