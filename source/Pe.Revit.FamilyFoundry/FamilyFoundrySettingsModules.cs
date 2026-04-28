using Pe.Revit.FamilyFoundry.Profiles;
using Pe.Shared.StorageRuntime.Modules;

namespace Pe.Revit.FamilyFoundry;

public static class FamilyFoundrySettingsRegistration {
    public static IReadOnlyList<StructuralSettingsModuleDescriptor> StructuralModules { get; } = [
        .. FFManagerSettingsRegistration.StructuralModules,
        .. FFMigratorSettingsRegistration.StructuralModules
    ];

    public static IReadOnlyList<ISettingsRootBinding> RootBindings { get; } = [
        .. FFManagerSettingsRegistration.RootBindings,
        .. FFMigratorSettingsRegistration.RootBindings
    ];
}
