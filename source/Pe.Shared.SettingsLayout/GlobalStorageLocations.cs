namespace Pe.Shared.SettingsLayout;

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

    public static string ResolveHostLogPath(string basePath) =>
        Path.Combine(ResolveGlobalDirectory(basePath), "host.log.txt");

    public static string ResolveRevitAppLogPath(string basePath) =>
        Path.Combine(ResolveGlobalDirectory(basePath), "revit.log.txt");
}