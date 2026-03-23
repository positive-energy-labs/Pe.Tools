using Pe.SettingsCatalog.Revit.AutoTag;
using Pe.SettingsCatalog.Revit.FamilyFoundry;
using Pe.StorageRuntime.Revit.Modules;

namespace Pe.SettingsCatalog.Revit;

public static class KnownSettingsRevitModules {
    public static CatalogSettingsModule<AutoTagSettings> AutoTag { get; } = new(KnownSettingsSchemas.AutoTag);
    public static CatalogSettingsModule<ProfileFamilyManager> FFManager { get; } = new(KnownSettingsSchemas.FFManager);
    public static CatalogSettingsModule<ProfileRemap> FFMigrator { get; } = new(KnownSettingsSchemas.FFMigrator);

    private static IReadOnlyDictionary<string, ISettingsModule> ModulesByKey { get; } =
        new Dictionary<string, ISettingsModule>(StringComparer.OrdinalIgnoreCase) {
            [KnownSettingsSchemas.AutoTag.ModuleKey] = AutoTag,
            [KnownSettingsSchemas.FFManager.ModuleKey] = FFManager,
            [KnownSettingsSchemas.FFMigrator.ModuleKey] = FFMigrator
        };

    public static IReadOnlyList<ISettingsModule> Authoring { get; } = KnownSettingsSchemas.Authoring
        .Select(schema => ModulesByKey[schema.ModuleKey])
        .ToList();

    public static void RegisterKnownSettingsModules(SettingsModuleRegistry registry) {
        foreach (var schema in KnownSettingsSchemas.Authoring)
            registry.Register(ModulesByKey[schema.ModuleKey]);
    }
}
