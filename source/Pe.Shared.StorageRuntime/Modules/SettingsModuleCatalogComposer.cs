namespace Pe.Shared.StorageRuntime.Modules;

public static class SettingsModuleCatalogComposer {
    public static IReadOnlyList<ISettingsModuleManifest> Combine(
        params IEnumerable<ISettingsModuleManifest>[] moduleSources
    ) =>
        moduleSources
            .Where(source => source != null)
            .SelectMany(source => source)
            .ToList();

    public static void RegisterRevitModules(
        SettingsModuleRegistry registry,
        params IEnumerable<ISettingsModuleManifest>[] moduleSources
    ) {
        foreach (var module in Combine(moduleSources)
                     .Where(module => module.HostScope != SettingsModuleHostScope.Host &&
                                      module.SettingsType != typeof(object))) {
            registry.Register(module);
        }
    }
}
