namespace Pe.StorageRuntime;

/// <summary>
///     Shared storage layout helpers for on-disk settings roots.
/// </summary>
public static class SettingsStorageLocations {
    public const string DefaultStorageDirectoryName = "Pe.App";
    public const string DefaultModuleSettingsDirectoryName = "settings";

    public static string GetDefaultBasePath() =>
        Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.MyDocuments),
            DefaultStorageDirectoryName
        );

    public static string ResolveModuleDirectory(string basePath, string moduleKey) {
        if (string.IsNullOrWhiteSpace(basePath))
            throw new ArgumentException("Base path is required.", nameof(basePath));
        if (string.IsNullOrWhiteSpace(moduleKey))
            throw new ArgumentException("Module key is required.", nameof(moduleKey));

        var normalizedBasePath = Path.GetFullPath(basePath);
        var normalizedModuleKey = SettingsPathing.NormalizeRelativePath(moduleKey, nameof(moduleKey));
        if (string.IsNullOrWhiteSpace(normalizedModuleKey))
            throw new ArgumentException("Module key is required.", nameof(moduleKey));

        return SettingsPathing.ResolveSafeSubDirectoryPath(
            normalizedBasePath,
            normalizedModuleKey,
            nameof(moduleKey)
        );
    }

    public static string ResolveModuleSettingsDirectory(string basePath, string moduleKey) =>
        Path.Combine(
            ResolveModuleDirectory(basePath, moduleKey),
            DefaultModuleSettingsDirectoryName
        );

    public static string ResolveSettingsRootDirectory(
        string basePath,
        string moduleKey,
        string rootKey
    ) {
        if (string.IsNullOrWhiteSpace(rootKey))
            throw new ArgumentException("Root key is required.", nameof(rootKey));

        var settingsDirectory = string.Equals(moduleKey, "Global", StringComparison.OrdinalIgnoreCase)
            ? ResolveModuleDirectory(basePath, moduleKey)
            : ResolveModuleSettingsDirectory(basePath, moduleKey);
        return SettingsPathing.ResolveSafeSubDirectoryPath(settingsDirectory, rootKey, nameof(rootKey));
    }
}
