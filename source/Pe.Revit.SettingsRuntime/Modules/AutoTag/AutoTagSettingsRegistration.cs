using Pe.Shared.StorageRuntime.Documents;
using Pe.Shared.StorageRuntime.Modules;

namespace Pe.Revit.SettingsRuntime.Modules.AutoTag;

public static class AutoTagSettingsRegistration {
    public static StructuralSettingsModuleDescriptor Module { get; } = new(
        "AutoTag",
        [new SettingsRootDescriptor("autotag", "autotag")]
    );

    public static ISettingsRootBinding<AutoTagSettings> Root { get; } = new SettingsRootBinding<AutoTagSettings>(
        Module,
        "autotag"
    );

    public static IReadOnlyList<StructuralSettingsModuleDescriptor> StructuralModules { get; } = [Module];
    public static IReadOnlyList<ISettingsRootBinding> RootBindings { get; } = [Root];
}
