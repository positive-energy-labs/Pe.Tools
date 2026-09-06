using Pe.Shared.StorageRuntime.Modules;

namespace Pe.Revit.FamilyFoundry;

/// <summary>One module: `FamilyFoundry`, roots `models` (family.json) and `patches` (patch.json).</summary>
public static class FamilyFoundrySettingsRegistration {
    static FamilyFoundrySettingsRegistration() => FamilyModelSettingsRegistration.RegisterValidator();

    public static IReadOnlyList<StructuralSettingsModuleDescriptor> StructuralModules { get; } = FamilyModelSettingsRegistration.StructuralModules;
    public static IReadOnlyList<ISettingsRootBinding> RootBindings { get; } = FamilyModelSettingsRegistration.RootBindings;
}
