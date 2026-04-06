using Pe.Shared.StorageRuntime.Capabilities;
using Pe.Shared.StorageRuntime.Documents;
using Pe.Shared.StorageRuntime.Json;
using Pe.Shared.StorageRuntime.Modules;

namespace Pe.Shared.SettingsCatalog.Manifests;

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
    Func<SettingsRuntimeMode, SettingsStorageModuleDefinition>? storageDefinitionFactory = null
    ) : BaseSettingsModule<TSettings>(moduleKey, defaultRootKey, storageOptions), ISettingsModuleManifest
    where TSettings : class {
    public new string DefaultRootKey => base.DefaultRootKey;

    public IReadOnlyList<SettingsRootDescriptor> Roots { get; } = roots ?? [new SettingsRootDescriptor(defaultRootKey, defaultRootKey)];

    public override SettingsStorageModuleDefinition CreateStorageDefinition(SettingsRuntimeMode runtimeMode) =>
        storageDefinitionFactory?.Invoke(runtimeMode) ?? new SettingsStorageModuleDefinition(
            this.DefaultRootKey,
            this.Roots.Select(root => root.RootKey).ToList(),
            this.StorageOptions
        );
}

public static class SettingsCatalogStorageProfiles {
    public static SettingsStorageModuleOptions SharedAuthoring { get; } = new(
        ["_shared", .. SettingsDirectiveRootCatalog.GlobalIncludeRoots],
        SettingsDirectiveRootCatalog.GlobalPresetRoots
    );
}
