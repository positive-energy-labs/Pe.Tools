using Pe.Shared.StorageRuntime.Documents;

namespace Pe.Shared.StorageRuntime.Modules;

public sealed record SettingsStorageModuleOptions(
    IReadOnlyCollection<string> IncludeRoots,
    IReadOnlyCollection<string> PresetRoots
) {
    public static SettingsStorageModuleOptions Empty { get; } = new([], []);
}

public sealed record SettingsStorageModuleRuntimeDefinition(
    string DefaultRootKey,
    IReadOnlyCollection<string> AllowedRootKeys,
    SettingsStorageModuleOptions StorageOptions,
    IReadOnlyDictionary<string, ISettingsDocumentValidator?> RootValidators
) {
    public static SettingsStorageModuleRuntimeDefinition CreateSingleRoot(
        string defaultRootKey,
        SettingsStorageModuleOptions storageOptions,
        ISettingsDocumentValidator? validator = null
    ) => new(
        defaultRootKey,
        [defaultRootKey],
        storageOptions,
        new Dictionary<string, ISettingsDocumentValidator?>(StringComparer.OrdinalIgnoreCase) {
            [defaultRootKey] = validator
        }
    );
}
