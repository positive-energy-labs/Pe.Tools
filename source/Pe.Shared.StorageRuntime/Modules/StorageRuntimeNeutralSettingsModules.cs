using Pe.Shared.StorageRuntime.Documents;

namespace Pe.Shared.StorageRuntime.Modules;

public static class StorageRuntimeNeutralSettingsModules {
    public static SettingsModuleManifest<object> GlobalFragments { get; } = new(
        "Global",
        "fragments",
        SettingsStorageProfiles.SharedAuthoring,
        [new SettingsRootDescriptor("fragments", "fragments")],
        hostScope: SettingsModuleHostScope.Host
    );

    public static IReadOnlyList<ISettingsModuleManifest> All { get; } = [GlobalFragments];
}

public static class StorageRuntimeStructuralModules {
    public static StructuralSettingsModuleDescriptor GlobalFragments { get; } =
        StorageRuntimeNeutralSettingsModules.GlobalFragments.ToStructuralDescriptor();

    public static IReadOnlyList<StructuralSettingsModuleDescriptor> All { get; } = [GlobalFragments];
}