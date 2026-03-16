using Pe.StorageRuntime.Capabilities;
using Pe.StorageRuntime.Modules;
using Pe.StorageRuntime.Revit.Validation;

namespace Pe.SettingsCatalog.Revit;

public static class KnownSettingsStorageDefinitions {
    public static IReadOnlyDictionary<string, SettingsStorageModuleDefinition> Create(
        SettingsRuntimeCapabilities availableCapabilities
    ) =>
        KnownSettingsSchemas.All.ToDictionary(
            schema => schema.ModuleKey,
            schema => new SettingsStorageModuleDefinition(
                schema.DefaultRootKey,
                schema.Roots.Select(root => root.RootKey).ToList(),
                schema.StorageOptions,
                schema.SettingsType == typeof(object)
                    ? null
                    : new SchemaBackedSettingsDocumentValidator(schema.SettingsType, availableCapabilities)
            ),
            StringComparer.OrdinalIgnoreCase
        );
}
