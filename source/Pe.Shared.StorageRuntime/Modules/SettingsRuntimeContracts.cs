using Pe.Shared.StorageRuntime.Documents;
using Pe.Shared.StorageRuntime.Json;

namespace Pe.Shared.StorageRuntime.Modules;

public enum SettingsModuleHostScope {
    Host,
    Session,
    ActiveDocument
}

public enum SettingsModuleActiveDocumentKind {
    Any,
    ProjectOnly,
    FamilyOnly
}

public sealed record StructuralSettingsModuleDescriptor(
    string ModuleKey,
    string DefaultRootKey,
    IReadOnlyList<SettingsRootDescriptor> Roots,
    SettingsStorageModuleOptions StorageOptions,
    SettingsModuleHostScope HostScope,
    SettingsModuleActiveDocumentKind ActiveDocumentKind
);

public interface ISettingsRootBinding {
    StructuralSettingsModuleDescriptor Module { get; }
    string RootKey { get; }
    Type SettingsType { get; }
}

public interface ISettingsRootBinding<TSettings> : ISettingsRootBinding where TSettings : class;

public sealed class SettingsRootBinding<TSettings>(
    StructuralSettingsModuleDescriptor module,
    string rootKey
) : ISettingsRootBinding<TSettings> where TSettings : class {
    public StructuralSettingsModuleDescriptor Module { get; } = module ?? throw new ArgumentNullException(nameof(module));

    public string RootKey { get; } = string.IsNullOrWhiteSpace(rootKey)
        ? throw new ArgumentException("Root key is required.", nameof(rootKey))
        : rootKey;

    public Type SettingsType => typeof(TSettings);
}

public static class SettingsStorageProfiles {
    public static SettingsStorageModuleOptions SharedAuthoring { get; } = new(
        ["_shared", .. SettingsDirectiveRootCatalog.GlobalIncludeRoots],
        SettingsDirectiveRootCatalog.GlobalPresetRoots
    );
}
