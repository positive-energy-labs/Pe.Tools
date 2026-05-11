using Pe.Shared.Product;

namespace Pe.Shared.StorageRuntime;

/// <summary>
///     Shared storage layout helpers for on-disk settings roots.
/// </summary>
public static class SettingsStorageLocations {
    public const string DefaultStorageDirectoryName = ProductIdentity.ProductName;
    public const string DefaultModuleSettingsDirectoryName = ProductPathNames.SettingsDirectoryName;

    public static string GetDefaultBasePath() =>
        ProductUserContentLayout.ForCurrentUser().Settings.RootPath;

    public static string ResolveModuleDirectory(string basePath, string moduleKey) {
        if (string.IsNullOrWhiteSpace(basePath))
            throw new ArgumentException("Base path is required.", nameof(basePath));
        if (string.IsNullOrWhiteSpace(moduleKey))
            throw new ArgumentException("Module key is required.", nameof(moduleKey));

        var normalizedBasePath = Path.GetFullPath(basePath);
        var normalizedModuleKey = SettingsPathing.NormalizeRelativePath(moduleKey, nameof(moduleKey));
        if (string.IsNullOrWhiteSpace(normalizedModuleKey))
            throw new ArgumentException("Module key is required.", nameof(moduleKey));

        return new ProductSettingsContentLayout(normalizedBasePath)
            .ResolveModuleDirectoryPath(normalizedModuleKey);
    }

    public static string ResolveModuleSettingsDirectory(string basePath, string moduleKey) =>
        new ProductSettingsContentLayout(Path.GetFullPath(basePath))
            .ResolveModuleSettingsDirectoryPath(moduleKey);

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