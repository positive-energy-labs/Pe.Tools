namespace Pe.Shared.HostContracts.Protocol;

public static class SettingsEditorRuntime {
    public const string RuntimeIdentity = "pe.tools.settings-editor";
    public const string VendorName = "Positive Energy";
    public const string ProductName = "Pe.Tools";
    public const string HostFolderName = "Host";
    public const string HostExecutableName = "Pe.Host.exe";
    public const string HostDllName = "Pe.Host.dll";

    public const string FrontendBaseUrlVariable = "PE_SETTINGS_EDITOR_BASE_URL";
    public const string FrontendRouteVariable = "PE_SETTINGS_EDITOR_ROUTE";
    public const string HostBaseUrlVariable = "PE_SETTINGS_EDITOR_HOST_BASE_URL";
    public const string HostExecutablePathVariable = "PE_SETTINGS_EDITOR_HOST_EXECUTABLE_PATH";
    public const string HostStartupTimeoutVariable = "PE_SETTINGS_EDITOR_HOST_STARTUP_TIMEOUT_MS";
    public const string HostProbeTimeoutVariable = "PE_SETTINGS_EDITOR_HOST_PROBE_TIMEOUT_MS";
    public const string HostAutoStartEnabledVariable = "PE_TOOLS_HOST_AUTOSTART_ENABLED";
    public const string BridgeAutoConnectEnabledVariable = "PE_SETTINGS_BRIDGE_AUTO_CONNECT";
    public const string PipeNameVariable = "PE_SETTINGS_EDITOR_PIPE_NAME";
    public const string SessionIdVariable = "PE_SETTINGS_EDITOR_SESSION_ID";
    public const string PipeConnectTimeoutMsVariable = "PE_SETTINGS_EDITOR_PIPE_CONNECT_TIMEOUT_MS";
    public const string HostRegistrationTimeoutMsVariable = "PE_SETTINGS_EDITOR_HOST_REGISTRATION_TIMEOUT_MS";
    public const string IdleShutdownEnabledVariable = "PE_SETTINGS_EDITOR_IDLE_SHUTDOWN_ENABLED";
    public const string IdleShutdownMinutesVariable = "PE_SETTINGS_EDITOR_IDLE_SHUTDOWN_MINUTES";
    public const string HostSingletonMutexName = @"Global\PositiveEnergy.Pe.Tools.Host";

    public const string DefaultFrontendBaseUrl = "http://localhost:5150";
    public const string DefaultFrontendRoute = "/settings-prototype";
    public const string DefaultHostBaseUrl = "http://localhost:5180";
    public const string DefaultPipeName = "Pe.Host.Bridge";
    public const int DefaultHostStartupTimeoutMs = 8000;
    public const int DefaultHostProbeTimeoutMs = 5000;
    public const int DefaultPipeConnectTimeoutMs = 1500;
    public const int DefaultHostRegistrationTimeoutMs = 4000;
    public static readonly TimeSpan DefaultIdleShutdownTimeout = TimeSpan.FromMinutes(10);

    public static string NormalizeRoutePath(string routePath) =>
        routePath.StartsWith("/", StringComparison.Ordinal)
            ? routePath
            : "/" + routePath;

    public static string GetSingleUserHostInstallDirectory() =>
        $@"%LocalAppDataFolder%\{VendorName}\{ProductName}\{HostFolderName}";

    public static string GetMultiUserHostInstallDirectory() =>
        $@"%ProgramFiles%\{VendorName}\{ProductName}\{HostFolderName}";

    public static string GetSingleUserHostInstallPath(string localAppData) =>
        Path.Combine(localAppData, VendorName, ProductName, HostFolderName);

    public static string GetMultiUserHostInstallPath(string programFiles) =>
        Path.Combine(programFiles, VendorName, ProductName, HostFolderName);

    public static IEnumerable<string> EnumerateHostExecutableCandidates(
        string? configuredPath,
        string localAppData,
        string programFiles
    ) {
        if (!string.IsNullOrWhiteSpace(configuredPath)) {
            yield return configuredPath;
            if (configuredPath.EndsWith(".exe", StringComparison.OrdinalIgnoreCase))
                yield return Path.ChangeExtension(configuredPath, ".dll");
        }

        var installRoots = new[] {
            GetSingleUserHostInstallPath(localAppData),
            GetMultiUserHostInstallPath(programFiles)
        };

        foreach (var root in installRoots) {
            yield return Path.Combine(root, HostExecutableName);
            yield return Path.Combine(root, HostDllName);
        }
    }
}
