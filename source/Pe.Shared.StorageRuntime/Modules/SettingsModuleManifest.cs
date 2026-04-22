using Pe.Shared.StorageRuntime.Capabilities;
using Pe.Shared.StorageRuntime.Documents;
using Pe.Shared.StorageRuntime.Json;

namespace Pe.Shared.StorageRuntime.Modules;

public sealed record StructuralSettingsModuleDescriptor(
    string ModuleKey,
    string DefaultRootKey,
    IReadOnlyList<SettingsRootDescriptor> Roots,
    SettingsStorageModuleOptions StorageOptions,
    SettingsModuleHostScope HostScope,
    SettingsModuleActiveDocumentKind ActiveDocumentKind
);

public interface ISettingsModuleManifest : ISettingsModule {
    string DefaultRootKey { get; }
    IReadOnlyList<SettingsRootDescriptor> Roots { get; }
    SettingsStorageModuleDefinition CreateStorageDefinition(SettingsRuntimeMode runtimeMode);
}

public sealed class SettingsModuleManifest<TSettings>(
    string moduleKey,
    string defaultRootKey,
    SettingsStorageModuleOptions storageOptions,
    IReadOnlyList<SettingsRootDescriptor>? roots = null,
    Func<SettingsRuntimeMode, SettingsStorageModuleDefinition>? storageDefinitionFactory = null,
    SettingsModuleHostScope hostScope = SettingsModuleHostScope.Session,
    SettingsModuleActiveDocumentKind activeDocumentKind = SettingsModuleActiveDocumentKind.Any
) : BaseSettingsModule<TSettings>(moduleKey, defaultRootKey, storageOptions), ISettingsModuleManifest
    where TSettings : class {
    public new string DefaultRootKey => base.DefaultRootKey;

    public IReadOnlyList<SettingsRootDescriptor> Roots { get; } =
        roots ?? [new SettingsRootDescriptor(defaultRootKey, defaultRootKey)];

    public override SettingsModuleHostScope HostScope { get; } = hostScope;

    public override SettingsModuleActiveDocumentKind ActiveDocumentKind { get; } = activeDocumentKind;

    public override SettingsStorageModuleDefinition CreateStorageDefinition(SettingsRuntimeMode runtimeMode) =>
        storageDefinitionFactory?.Invoke(runtimeMode) ?? new SettingsStorageModuleDefinition(
            this.DefaultRootKey,
            this.Roots.Select(root => root.RootKey).ToList(),
            this.StorageOptions
        );
}

public static class SettingsStorageProfiles {
    public static SettingsStorageModuleOptions SharedAuthoring { get; } = new(
        ["_shared", .. SettingsDirectiveRootCatalog.GlobalIncludeRoots],
        SettingsDirectiveRootCatalog.GlobalPresetRoots
    );
}

public static class StructuralSettingsModuleDescriptorMapper {
    public static StructuralSettingsModuleDescriptor ToStructuralDescriptor(this ISettingsModuleManifest module) =>
        new(
            module.ModuleKey,
            module.DefaultRootKey,
            module.Roots,
            module.StorageOptions,
            module.HostScope,
            module.ActiveDocumentKind
        );
}