using Pe.Shared.StorageRuntime.Documents;
using Pe.Shared.StorageRuntime.Modules;

namespace Pe.Revit.SettingsRuntime.Modules.AutoTag;

public static class AutoTagSettingsRegistration {
    public static StructuralSettingsModuleDescriptor Module { get; } = new(
        "AutoTag",
        "autotag",
        [new SettingsRootDescriptor("autotag", "autotag")],
        SettingsStorageModuleOptions.Empty,
        SettingsModuleHostScope.ActiveDocument,
        SettingsModuleActiveDocumentKind.ProjectOnly
    );

    public static ISettingsRootBinding<AutoTagSettings> Root { get; } = new SettingsRootBinding<AutoTagSettings>(
        Module,
        "autotag"
    );

    public static IReadOnlyList<StructuralSettingsModuleDescriptor> StructuralModules { get; } = [Module];
    public static IReadOnlyList<ISettingsRootBinding> RootBindings { get; } = [Root];
}
