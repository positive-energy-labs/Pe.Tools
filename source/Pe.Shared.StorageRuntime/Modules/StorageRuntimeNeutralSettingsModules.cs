using Pe.Shared.StorageRuntime.Documents;

namespace Pe.Shared.StorageRuntime.Modules;

public static class StorageRuntimeStructuralModules {
    public static StructuralSettingsModuleDescriptor GlobalFragments { get; } = new(
        "Global",
        "fragments",
        [new SettingsRootDescriptor("fragments", "fragments")],
        SettingsStorageProfiles.SharedAuthoring,
        SettingsModuleHostScope.Host,
        SettingsModuleActiveDocumentKind.Any
    );

    public static IReadOnlyList<StructuralSettingsModuleDescriptor> All { get; } = [GlobalFragments];
}
