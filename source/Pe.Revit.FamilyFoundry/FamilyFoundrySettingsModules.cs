using Pe.Revit.FamilyFoundry.Profiles;
using Pe.Shared.StorageRuntime.Modules;

namespace Pe.Revit.FamilyFoundry;

public static class FamilyFoundrySettingsRegistration {
    static FamilyFoundrySettingsRegistration() {
        FamilyModelSettingsRegistration.RegisterValidator();
    }

    public static IReadOnlyList<StructuralSettingsModuleDescriptor> StructuralModules { get; } = [
        .. FFManagerSettingsRegistration.StructuralModules,
        .. FFMigratorSettingsRegistration.StructuralModules,
        .. DesiredFamilyMigrationSettingsRegistration.StructuralModules,
        .. FamilyModelSettingsRegistration.StructuralModules
    ];

    public static IReadOnlyList<ISettingsRootBinding> RootBindings { get; } = [
        .. FFManagerSettingsRegistration.RootBindings,
        .. FFMigratorSettingsRegistration.RootBindings,
        .. DesiredFamilyMigrationSettingsRegistration.RootBindings,
        .. FamilyModelSettingsRegistration.RootBindings
    ];
}
