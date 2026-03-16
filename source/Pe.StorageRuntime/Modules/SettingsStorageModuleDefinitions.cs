using Pe.StorageRuntime.Documents;

namespace Pe.StorageRuntime.Modules;

public static class SettingsStorageModuleDefinitions {
    public static IReadOnlyDictionary<string, SettingsStorageModuleDefinition> CreateSingleRootLookup(
        IEnumerable<ISettingsModuleDescriptor> modules,
        Func<ISettingsModuleDescriptor, ISettingsDocumentValidator?>? validatorFactory = null
    ) =>
        modules.ToDictionary(
            module => module.ModuleKey,
            module => SettingsStorageModuleDefinition.CreateSingleRoot(
                module.DefaultSubDirectory,
                module.StorageOptions,
                validatorFactory?.Invoke(module)
            ),
            StringComparer.OrdinalIgnoreCase
        );
}
