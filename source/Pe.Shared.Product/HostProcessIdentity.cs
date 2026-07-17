using Newtonsoft.Json.Linq;
using System.Security.Cryptography;
using System.Text;

namespace Pe.Shared.Product;

public static class HostProcessIdentity {
    public const string DirectoryName = ProductPathNames.HostDirectoryName;
    public const string ExecutableName = "Pe.Host.exe";

    // The installed service is "host"; source hosts derive a stable key from their checkout root.
    // HealthPath/ShutdownPath are the loopback routes the SDK primitive probes and authorizes.
    public const string ServiceName = "host";
    public const string ServiceNameVariable = "PE_TOOLS_HOST_SERVICE_NAME";
    public const string HealthPath = "/host/status";
    public const string ShutdownPath = "/admin/shutdown";

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

    public static string ResolveServiceName(ProductRuntimeLane lane, string? sourceRoot) {
        if (lane == ProductRuntimeLane.Installed)
            return ServiceName;
        if (string.IsNullOrWhiteSpace(sourceRoot))
            throw new ArgumentException("A dev host requires a source root for service identity.", nameof(sourceRoot));
        return SourceServiceName(sourceRoot!);
    }

    public static string SourceServiceName(string sourceRoot) {
        var normalized = Path.GetFullPath(sourceRoot)
            .Replace('\\', '/')
            .TrimEnd('/')
            .ToLowerInvariant();
        using var sha256 = SHA256.Create();
        var hash = sha256.ComputeHash(Encoding.UTF8.GetBytes(normalized));
        var suffix = BitConverter.ToString(hash).Replace("-", "").ToLowerInvariant().Substring(0, 12);
        return $"{ServiceName}-source-{suffix}";
    }

    /// <summary>
    ///     The actual bound port from the SDK runtime service file
    ///     (<c>state/service/&lt;service-name&gt;.json</c>), rewritten by the host on every bind and deleted on
    ///     graceful exit — so it can never go stale the way a process-env copy did. Port-only
    ///     projection; full schema validation stays with the SDK's ServiceFile/pe-service.
    ///     NOTE: this is intentionally a minimal hand-rolled projection rather than the SDK
    ///     <c>ServiceFile.Read</c> reader — Pe.Shared.Product is a platform-neutral Shared project
    ///     and the SDK build guard forbids it referencing the Revit-flavored Pe.Revit.Loader. The
    ///     authoritative <c>ServiceFile.Read</c> path lives in TsHostLauncher (Pe.App), which may
    ///     reference the loader. See D8 in docs/rework/IPC-SEAM-SPEC.md.
    /// </summary>
    private static string? TryReadServiceFileBaseUrl() {
        try {
            var serviceName = FirstNonBlank(
                Environment.GetEnvironmentVariable(ServiceNameVariable),
                ServiceName
            )!;
            var path = Path.Combine(
                ProductRuntimeLayout.ForCurrentUser().State.RootPath,
                "service",
                $"{serviceName}.json"
            );
            if (!File.Exists(path))
                return null;

            var port = JObject.Parse(File.ReadAllText(path)).Value<int?>("port");
            return port is int value ? $"http://127.0.0.1:{value}" : null;
        } catch {
            return null;
        }
    }

    private static string? FirstNonBlank(params string?[] values) =>
        values.FirstOrDefault(value => !string.IsNullOrWhiteSpace(value))?.Trim();
}
