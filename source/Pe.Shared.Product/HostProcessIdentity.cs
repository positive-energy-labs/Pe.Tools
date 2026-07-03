namespace Pe.Shared.Product;

public static class HostProcessIdentity {
    public const string DirectoryName = ProductPathNames.HostDirectoryName;
    public const string ExecutableName = "Pe.Host.exe";

    public const string FrontendBaseUrlVariable = "PE_TOOLS_FRONTEND_BASE_URL";
    public const string HostBaseUrlVariable = "PE_TOOLS_HOST_BASE_URL";
    public const string HostExecutablePathVariable = "PE_TOOLS_HOST_EXECUTABLE_PATH";

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
        }

        var binaries = ProductRuntimeLayout.ForCurrentUser(localAppData).Binaries;
        yield return binaries.HostExecutablePath;
    }

    private static string? FirstNonBlank(params string?[] values) =>
        values.FirstOrDefault(value => !string.IsNullOrWhiteSpace(value))?.Trim();
}
