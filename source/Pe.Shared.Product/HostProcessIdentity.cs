using Newtonsoft.Json.Linq;

namespace Pe.Shared.Product;

public static class HostProcessIdentity {
    public const string DirectoryName = ProductPathNames.HostDirectoryName;
    public const string ExecutableName = "Pe.Host.exe";

    public const string FrontendBaseUrlVariable = "PE_TOOLS_FRONTEND_BASE_URL";
    public const string HostBaseUrlVariable = "PE_TOOLS_HOST_BASE_URL";
    public const string HostExecutablePathVariable = "PE_TOOLS_HOST_EXECUTABLE_PATH";

    public const string DefaultFrontendBaseUrl = "http://localhost:5150";
    public const string DefaultHostBaseUrl = "http://127.0.0.1:5180";

    public static string ResolveFrontendBaseUrl(string? overrideValue = null) =>
        FirstNonBlank(overrideValue, Environment.GetEnvironmentVariable(FrontendBaseUrlVariable))
        ?? DefaultFrontendBaseUrl;

    public static string ResolveHostBaseUrl(string? overrideValue = null) =>
        FirstNonBlank(overrideValue, Environment.GetEnvironmentVariable(HostBaseUrlVariable))
        ?? TryReadServiceFileBaseUrl()
        ?? DefaultHostBaseUrl;

    /// <summary>
    ///     The actual bound port from the SDK runtime service file
    ///     (<c>state/service/host.json</c>), rewritten by the host on every bind and deleted on
    ///     graceful exit — so it can never go stale the way a process-env copy did. Port-only
    ///     projection; full schema validation stays with the SDK's ServiceFile/pe-service.
    /// </summary>
    private static string? TryReadServiceFileBaseUrl() {
        try {
            var path = Path.Combine(
                ProductRuntimeLayout.ForCurrentUser().State.RootPath,
                "service",
                "host.json"
            );
            if (!File.Exists(path))
                return null;

            var port = JObject.Parse(File.ReadAllText(path)).Value<int?>("port");
            return port is int value ? $"http://127.0.0.1:{value}" : null;
        } catch {
            return null;
        }
    }

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
