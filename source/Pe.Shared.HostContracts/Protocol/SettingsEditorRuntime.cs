namespace Pe.Shared.HostContracts.Protocol;

public static class SettingsEditorRuntime {
    public const string RuntimeIdentity = "pe.tools.settings-editor";
    public const string VendorName = Pe.Shared.SettingsLayout.DeploymentRuntimeLocations.VendorName;
    public const string ProductName = Pe.Shared.SettingsLayout.DeploymentRuntimeLocations.ProductName;
    public const string HostFolderName = Pe.Shared.SettingsLayout.DeploymentRuntimeLocations.HostFolderName;
    public const string HostExecutableName = Pe.Shared.SettingsLayout.DeploymentRuntimeLocations.HostExecutableName;
    public const string HostDllName = Pe.Shared.SettingsLayout.DeploymentRuntimeLocations.HostDllName;
    public const string CliExecutableName = Pe.Shared.SettingsLayout.DeploymentRuntimeLocations.CliExecutableName;
    public const string CliDllName = Pe.Shared.SettingsLayout.DeploymentRuntimeLocations.CliDllName;

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

    public static string GetSingleUserInstallDirectory() =>
        Pe.Shared.SettingsLayout.DeploymentRuntimeLocations.GetPerUserInstallDirectory();

    public static string GetSingleUserHostInstallDirectory() =>
        Pe.Shared.SettingsLayout.DeploymentRuntimeLocations.GetPerUserHostInstallDirectory();

    public static string GetSingleUserInstallPath(string localAppData) =>
        Pe.Shared.SettingsLayout.DeploymentRuntimeLocations.GetPerUserInstallRootPath(localAppData);

    public static string GetSingleUserHostInstallPath(string localAppData) =>
        Pe.Shared.SettingsLayout.DeploymentRuntimeLocations.GetPerUserHostInstallPath(localAppData);

    public static IEnumerable<string> EnumerateHostExecutableCandidates(
        string? configuredPath,
        string localAppData
    ) {
        if (configuredPath is string configuredExecutablePath &&
            !string.IsNullOrWhiteSpace(configuredExecutablePath)) {
            yield return configuredExecutablePath;
            if (configuredExecutablePath.EndsWith(".exe", StringComparison.OrdinalIgnoreCase)) {
                var configuredDllPath = Path.ChangeExtension(configuredExecutablePath, ".dll");
                if (!string.IsNullOrWhiteSpace(configuredDllPath))
                    yield return configuredDllPath;
            }
        }

        var installRoot = GetSingleUserHostInstallPath(localAppData);
        yield return Path.Combine(installRoot, HostExecutableName);
        yield return Path.Combine(installRoot, HostDllName);
    }
}
