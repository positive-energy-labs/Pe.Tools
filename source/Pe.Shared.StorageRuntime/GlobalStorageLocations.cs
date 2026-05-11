namespace Pe.Shared.StorageRuntime;

public static class GlobalStorageLocations {
    public static string ResolveGlobalDirectory(string basePath) =>
        SettingsStorageLocations.ResolveModuleDirectory(basePath, "Global");

    public static string ResolveSettingsPath(string basePath, string fileName = "settings.json") =>
        Path.Combine(ResolveGlobalDirectory(basePath), fileName);

    public static string ResolveFragmentsDirectory(string basePath) =>
        SettingsPathing.ResolveSafeSubDirectoryPath(
            ResolveGlobalDirectory(basePath),
            "fragments",
            "fragments"
        );
}
