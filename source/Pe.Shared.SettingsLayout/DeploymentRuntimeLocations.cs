namespace Pe.Shared.SettingsLayout;

public static class DeploymentRuntimeLocations {
    public const string VendorName = "Positive Energy";
    public const string ProductName = "Pe.Tools";
    public const string HostFolderName = "Host";
    public const string StateDirectoryName = "State";
    public const string LogsDirectoryName = "Logs";
    public const string CacheDirectoryName = "Cache";
    public const string HostExecutableName = "Pe.Host.exe";
    public const string HostDllName = "Pe.Host.dll";
    public const string CliExecutableName = "pe-dev.exe";
    public const string CliDllName = "pe-dev.dll";

    public static string GetPerUserInstallDirectory() =>
        $@"%LocalAppDataFolder%\{VendorName}\{ProductName}";

    public static string GetPerUserHostInstallDirectory() =>
        $@"%LocalAppDataFolder%\{VendorName}\{ProductName}\{HostFolderName}";

    public static string GetPerUserInstallRootPath(string? localAppData = null) =>
        Path.Combine(
            ResolveLocalAppData(localAppData),
            VendorName,
            ProductName
        );

    public static string GetPerUserHostInstallPath(string? localAppData = null) =>
        Path.Combine(
            GetPerUserInstallRootPath(localAppData),
            HostFolderName
        );

    public static string GetPerUserHostExecutablePath(string? localAppData = null) =>
        Path.Combine(GetPerUserHostInstallPath(localAppData), HostExecutableName);

    public static string GetPerUserHostDllPath(string? localAppData = null) =>
        Path.Combine(GetPerUserHostInstallPath(localAppData), HostDllName);

    public static string GetPerUserCliExecutablePath(string? localAppData = null) =>
        Path.Combine(GetPerUserHostInstallPath(localAppData), CliExecutableName);

    public static string GetPerUserCliDllPath(string? localAppData = null) =>
        Path.Combine(GetPerUserHostInstallPath(localAppData), CliDllName);

    public static string GetStateRootPath(string? localAppData = null) =>
        Path.Combine(GetPerUserInstallRootPath(localAppData), StateDirectoryName);

    public static string GetGlobalStatePath(string? localAppData = null) =>
        Path.Combine(GetStateRootPath(localAppData), "Global");

    public static string GetModuleStatePath(string moduleKey, string? localAppData = null) {
        if (string.IsNullOrWhiteSpace(moduleKey))
            throw new ArgumentException("Module key is required.", nameof(moduleKey));

        return SettingsPathing.ResolveSafeSubDirectoryPath(
            GetStateRootPath(localAppData),
            moduleKey,
            nameof(moduleKey)
        );
    }

    public static string GetLogRootPath(string? localAppData = null) =>
        Path.Combine(GetPerUserInstallRootPath(localAppData), LogsDirectoryName);

    public static string GetCacheRootPath(string? localAppData = null) =>
        Path.Combine(GetPerUserInstallRootPath(localAppData), CacheDirectoryName);

    private static string ResolveLocalAppData(string? localAppData) =>
        string.IsNullOrWhiteSpace(localAppData)
            ? Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData)
            : Path.GetFullPath(localAppData);
}
