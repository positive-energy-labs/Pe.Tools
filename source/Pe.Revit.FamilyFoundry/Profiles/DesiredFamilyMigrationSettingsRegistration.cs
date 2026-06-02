using Pe.Revit.FamilyFoundry.DesiredState;
using Pe.Revit.SettingsRuntime.Validation;
using Pe.Shared.StorageRuntime.Capabilities;
using Pe.Shared.StorageRuntime.Documents;
using Pe.Shared.StorageRuntime.Modules;

namespace Pe.Revit.FamilyFoundry.Profiles;

public static class DesiredFamilyMigrationSettingsRegistration {
    public static StructuralSettingsModuleDescriptor Module { get; } = new(
        "CmdFFDesiredMigrator",
        "profiles",
        [new SettingsRootDescriptor("profiles", "profiles")],
        SettingsStorageProfiles.SharedAuthoring,
        SettingsModuleHostScope.Session,
        SettingsModuleActiveDocumentKind.Any
    );

    public static ISettingsRootBinding<DesiredFamilyMigrationProfile> Root { get; } =
        new SettingsRootBinding<DesiredFamilyMigrationProfile>(
            Module,
            "profiles",
            CreateValidator
        );

    public static IReadOnlyList<StructuralSettingsModuleDescriptor> StructuralModules { get; } = [Module];
    public static IReadOnlyList<ISettingsRootBinding> RootBindings { get; } = [Root];

    private static ISettingsDocumentValidator? CreateValidator(SettingsRuntimeMode runtimeMode) =>
        runtimeMode == SettingsRuntimeMode.LiveDocument
            ? new SchemaBackedSettingsDocumentValidator(typeof(DesiredFamilyMigrationProfile), runtimeMode)
            : null;
}
