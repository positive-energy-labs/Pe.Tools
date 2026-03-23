using Pe.SettingsCatalog;
using Pe.SettingsCatalog.Revit.AutoTag;
using Pe.SettingsCatalog.Revit.FamilyFoundry;
using Pe.StorageRuntime.Documents;
using Pe.StorageRuntime.Json;
using Pe.StorageRuntime.Modules;

namespace Pe.SettingsCatalog.Revit;

public static class KnownSettingsSchemas {
    private static SettingsStorageModuleOptions SharedStorageOptions { get; } = new(
        ["_shared", .. SettingsDirectiveRootCatalog.GlobalIncludeRoots],
        SettingsDirectiveRootCatalog.GlobalPresetRoots
    );

    public static SettingsSchemaRegistration AutoTag { get; } = new(
        KnownSettingsCatalogModules.AutoTag,
        typeof(AutoTagSettings)
    );

    public static SettingsSchemaRegistration FFManager { get; } = new(
        KnownSettingsCatalogModules.FFManager,
        typeof(ProfileFamilyManager)
    );

    public static SettingsSchemaRegistration FFMigrator { get; } = new(
        KnownSettingsCatalogModules.FFMigrator,
        typeof(ProfileRemap)
    );

    public static SettingsSchemaRegistration GlobalFragments { get; } = new(
        new SettingsCatalogModule("Global", "fragments", SharedStorageOptions),
        typeof(object),
        [new SettingsRootDescriptor("fragments", "fragments")]
    );

    public static IReadOnlyList<SettingsSchemaRegistration> All { get; } = [
        AutoTag,
        FFManager,
        FFMigrator,
        GlobalFragments
    ];

    public static IReadOnlyList<SettingsSchemaRegistration> Authoring { get; } = [
        AutoTag,
        FFManager,
        FFMigrator
    ];
}
