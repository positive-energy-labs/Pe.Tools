using Pe.Revit.ServiceClient;
using Pe.Shared.Product;
using Newtonsoft.Json.Linq;
using System.Net.Http;

namespace Pe.Shared.HostContracts.Transport;

/// <summary>
///     How a .NET caller addresses the TS host: service identity, loopback probe routes, the
///     product-owned override env vars, and base-URL resolution. This is transport, not product
///     identity — the installed file layout (which directory, which executable) is the installer
///     manifest's business, not this type's.
/// </summary>
public static class HostEndpoint {
    // The installed service is "host"; source hosts derive a stable key from their checkout root.
    // HealthPath/ShutdownPath are the loopback routes the SDK primitive probes and authorizes.
    public const string ServiceName = "host";
    public const string ServiceNameVariable = "PE_TOOLS_HOST_SERVICE_NAME";
    public const string HealthPath = "/host/status";
    public const string ShutdownPath = "/admin/shutdown";
    public const string RuntimeServiceHeader = "x-pe-runtime-service";

    public const string FrontendBaseUrlVariable = "PE_TOOLS_FRONTEND_BASE_URL";
    public const string HostBaseUrlVariable = "PE_TOOLS_HOST_BASE_URL";
    public const string HostExecutablePathVariable = "PE_TOOLS_HOST_EXECUTABLE_PATH";

    public const string DefaultFrontendBaseUrl = "http://localhost:5150";

    public static string ResolveFrontendBaseUrl(string? overrideValue = null) =>
        FirstNonBlank(overrideValue, Environment.GetEnvironmentVariable(FrontendBaseUrlVariable))
        ?? DefaultFrontendBaseUrl;

    public static string ResolveHostBaseUrl(string? overrideValue = null) =>
        ResolveHostBaseUrl(ProductRuntimeLayout.Current, InstalledExecutablePath, overrideValue);

    /// <summary>The configured runtime's host, verified against its receipt and its live status.</summary>
    public static string ResolveHostBaseUrl(ProductRuntimeLayout runtime, string? installedExecutable, string? overrideValue) {
        var serviceName = ResolveServiceName(runtime);
        var installed = runtime.Lane == ProductLane.Installed;
        if (installed && string.IsNullOrWhiteSpace(installedExecutable))
            throw new InvalidOperationException("The loaded payload has no verified canonical installation owner.");
        var discovered = PeServiceDiscovery.TryDiscover(runtime.RootPath, serviceName)
            ?? throw new InvalidOperationException($"No running '{serviceName}' host for the loaded payload.");
        if (discovered.Lane != runtime.LaneName || (installed ? !string.IsNullOrWhiteSpace(discovered.SourceRoot) : !SameSourceRoot(discovered.SourceRoot, runtime.SourceRoot)))
            throw new InvalidOperationException("The host service receipt does not match the loaded payload's runtime owner.");
        if (installed && !SameSourceRoot(discovered.ExecutablePath, installedExecutable))
            throw new InvalidOperationException("The host service receipt does not name the canonical installed executable.");
        var baseUrl = $"http://127.0.0.1:{discovered.Port}";
        var configured = FirstNonBlank(overrideValue, Environment.GetEnvironmentVariable(HostBaseUrlVariable));
        if (configured is not null && !string.Equals(configured.TrimEnd('/'), baseUrl, StringComparison.OrdinalIgnoreCase))
            throw new InvalidOperationException($"Host override '{configured}' does not address this payload's host '{baseUrl}'.");
        using var client = new HttpClient { Timeout = TimeSpan.FromMilliseconds(HostRuntimeDefaults.DefaultHostProbeTimeoutMs) };
        using var request = new HttpRequestMessage(HttpMethod.Get, baseUrl + HealthPath);
        request.Headers.Add(RuntimeServiceHeader, serviceName);
        using var response = client.SendAsync(request).GetAwaiter().GetResult();
        response.EnsureSuccessStatusCode();
        var status = JObject.Parse(response.Content.ReadAsStringAsync().GetAwaiter().GetResult());
        if ((string?)status["lane"] != runtime.LaneName || (string?)status["serviceName"] != serviceName || (int?)status["processId"] != discovered.Pid
            || (installed
                ? !string.IsNullOrWhiteSpace((string?)status["sourceRoot"]) || !SameSourceRoot((string?)status["installedRoot"], runtime.InstallRoot) || !SameSourceRoot((string?)status["executablePath"], installedExecutable)
                : !SameSourceRoot((string?)status["sourceRoot"], runtime.SourceRoot)))
            throw new InvalidOperationException("The host listener does not match the loaded payload's runtime owner.");
        return baseUrl;
    }

    /// <summary>The installed host executable the SDK manifest resolves; Pe.App sets it once in Startup, null in dev.</summary>
    public static string? InstalledExecutablePath { get; set; }

    public static string RuntimeServiceName => ResolveServiceName(ProductRuntimeLayout.Current);

    private static bool SameSourceRoot(string? left, string? right) =>
        !string.IsNullOrWhiteSpace(left) && !string.IsNullOrWhiteSpace(right)
        && PeServiceDiscovery.NormalizeSourceRoot(left!) == PeServiceDiscovery.NormalizeSourceRoot(right!);

    /// <summary>The installed service is the one global name; a dev host's name derives from its checkout.</summary>
    public static string ResolveServiceName(ProductRuntimeLayout runtime) =>
        runtime.Lane == ProductLane.Installed ? ServiceName : SourceServiceName(runtime.OwnerRoot);

    public static string SourceServiceName(string sourceRoot) =>
        PeServiceDiscovery.SourceServiceName(ServiceName, sourceRoot);

    private static string? FirstNonBlank(params string?[] values) =>
        values.FirstOrDefault(value => !string.IsNullOrWhiteSpace(value))?.Trim();
}
