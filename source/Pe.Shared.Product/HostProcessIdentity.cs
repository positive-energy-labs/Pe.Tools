namespace Pe.Shared.Product;

public static class HostProcessIdentity {
    public const string RuntimeIdentity = "pe.tools.host";

    public const string DirectoryName = ProductPathNames.HostDirectoryName;
    public const string ExecutableName = "Pe.Host.exe";
    public const string DllName = "Pe.Host.dll";

    public const string FrontendBaseUrlVariable = "PE_TOOLS_FRONTEND_BASE_URL";
    public const string HostBaseUrlVariable = "PE_TOOLS_HOST_BASE_URL";
    public const string HostExecutablePathVariable = "PE_TOOLS_HOST_EXECUTABLE_PATH";
    public const string HostSingletonMutexName = @"Global\PositiveEnergy.Pe.Tools.Host";
    public const string HostTakeoverEventName = @"Global\PositiveEnergy.Pe.Tools.Host.Takeover";

    public const string DefaultFrontendBaseUrl = "http://localhost:5150";
    public const string DefaultHostBaseUrl = "http://localhost:5180";

    public static string ResolveFrontendBaseUrl(string? overrideValue = null) =>
        FirstNonBlank(overrideValue, Environment.GetEnvironmentVariable(FrontendBaseUrlVariable))
        ?? DefaultFrontendBaseUrl;

    public static string ResolveHostBaseUrl(string? overrideValue = null) =>
        FirstNonBlank(overrideValue, Environment.GetEnvironmentVariable(HostBaseUrlVariable))
        ?? DefaultHostBaseUrl;

    public static IEnumerable<string> EnumerateExecutableCandidates(
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

        var binaries = ProductRuntimeLayout.ForCurrentUser(localAppData).Binaries;
        yield return binaries.HostExecutablePath;
        yield return binaries.HostDllPath;
    }

    private static string? FirstNonBlank(params string?[] values) =>
        values.FirstOrDefault(value => !string.IsNullOrWhiteSpace(value))?.Trim();
}
