using Pe.Shared.StorageRuntime.Documents;

namespace Pe.Shared.StorageRuntime.Modules;

public sealed record SettingsStorageModuleOptions(
    IReadOnlyCollection<string> IncludeRoots,
    IReadOnlyCollection<string> PresetRoots
) {
    public static SettingsStorageModuleOptions Empty { get; } = new([], []);
}

public sealed record SettingsStorageModuleDefinition(
    string DefaultRootKey,
    IReadOnlyCollection<string> AllowedRootKeys,
    SettingsStorageModuleOptions StorageOptions,
    ISettingsDocumentValidator? Validator = null
) {
    public static SettingsStorageModuleDefinition CreateSingleRoot(
        string defaultRootKey,
        SettingsStorageModuleOptions storageOptions,
        ISettingsDocumentValidator? validator = null
    ) => new(defaultRootKey, [defaultRootKey], storageOptions, validator);
}
