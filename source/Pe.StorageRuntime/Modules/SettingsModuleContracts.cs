using Pe.StorageRuntime.Documents;

namespace Pe.StorageRuntime.Modules;

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

public interface ISettingsModuleDescriptor {
    string ModuleKey { get; }

    string DefaultSubDirectory { get; }

    Type SettingsType { get; }

    SettingsStorageModuleOptions StorageOptions { get; }
}

public record SettingsModuleDescriptor(
    string ModuleKey,
    string DefaultSubDirectory,
    Type SettingsType,
    SettingsStorageModuleOptions StorageOptions
) : ISettingsModuleDescriptor;
