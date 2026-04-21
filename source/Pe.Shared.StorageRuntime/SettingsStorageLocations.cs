namespace Pe.Shared.StorageRuntime;

/// <summary>
///     Shared storage layout helpers for on-disk settings roots.
/// </summary>
public static class SettingsStorageLocations {
    public const string DefaultStorageDirectoryName = "Pe.App";
    public const string DefaultModuleSettingsDirectoryName = "settings";

    public static string GetDefaultBasePath() =>
        ResolvePreferredBasePath(
            Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.MyDocuments),
                DefaultStorageDirectoryName
            ),
            EnumerateAlternateDefaultBasePaths()
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

    internal static string ResolvePreferredBasePath(
        string primaryBasePath,
        IEnumerable<string> alternateBasePaths
    ) {
        if (string.IsNullOrWhiteSpace(primaryBasePath))
            throw new ArgumentException("Primary base path is required.", nameof(primaryBasePath));
        if (alternateBasePaths == null)
            throw new ArgumentNullException(nameof(alternateBasePaths));

        var candidates = new List<string>();
        AddCandidate(candidates, primaryBasePath);

        foreach (var alternateBasePath in alternateBasePaths)
            AddCandidate(candidates, alternateBasePath);

        var candidatesWithSettings = candidates
            .Where(ContainsGlobalSettingsFile)
            .ToList();
        if (candidatesWithSettings.Count != 0)
            return candidatesWithSettings[0];

        var existingCandidates = candidates
            .Where(Directory.Exists)
            .ToList();
        if (existingCandidates.Count != 0)
            return existingCandidates[0];

        return candidates[0];
    }

    private static IEnumerable<string> EnumerateAlternateDefaultBasePaths() {
        var oneDriveRoot = Environment.GetEnvironmentVariable("OneDrive");
        if (!string.IsNullOrWhiteSpace(oneDriveRoot))
            yield return Path.Combine(oneDriveRoot, "Documents", DefaultStorageDirectoryName);

        var userProfile = Environment.GetFolderPath(Environment.SpecialFolder.UserProfile);
        if (!string.IsNullOrWhiteSpace(userProfile))
            yield return Path.Combine(userProfile, "OneDrive", "Documents", DefaultStorageDirectoryName);
    }

    private static void AddCandidate(ICollection<string> candidates, string? candidatePath) {
        if (string.IsNullOrWhiteSpace(candidatePath))
            return;

        var normalizedPath = Path.GetFullPath(candidatePath);
        if (!candidates.Contains(normalizedPath))
            candidates.Add(normalizedPath);
    }

    private static bool ContainsGlobalSettingsFile(string basePath) =>
        File.Exists(Path.Combine(basePath, "Global", "settings.json"));
}
