using Pe.StorageRuntime.Json;
using Pe.StorageRuntime.Modules;

namespace Pe.SettingsCatalog;

public sealed record SettingsCatalogModule(
    string ModuleKey,
    string DefaultRootKey,
    SettingsStorageModuleOptions StorageOptions
);

public static class KnownSettingsCatalogModules {
    private static SettingsStorageModuleOptions SharedStorageOptions { get; } = new(
        ["_shared", .. SettingsDirectiveRootCatalog.GlobalIncludeRoots],
        SettingsDirectiveRootCatalog.GlobalPresetRoots
    );

    public static SettingsCatalogModule AutoTag { get; } = new(
        "AutoTag",
        "autotag",
        SettingsStorageModuleOptions.Empty
    );

    public static SettingsCatalogModule FFManager { get; } = new(
        "CmdFFManager",
        "profiles",
        SharedStorageOptions
    );

    public static SettingsCatalogModule FFMigrator { get; } = new(
        "CmdFFMigrator",
        "profiles",
        SharedStorageOptions
    );

    public static IReadOnlyList<SettingsCatalogModule> All { get; } = [
        AutoTag,
        FFManager,
        FFMigrator
    ];
}
