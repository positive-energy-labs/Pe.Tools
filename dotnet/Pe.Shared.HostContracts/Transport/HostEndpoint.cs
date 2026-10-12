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
    public const string DefaultHostBaseUrl = "http://127.0.0.1:5180";

    public static string ResolveFrontendBaseUrl(string? overrideValue = null) =>
        FirstNonBlank(overrideValue, Environment.GetEnvironmentVariable(FrontendBaseUrlVariable))
        ?? DefaultFrontendBaseUrl;

    public static string ResolveHostBaseUrl(string? overrideValue = null) {
        var serviceName = ResolveServiceName(ConfiguredLane ?? throw new InvalidOperationException("The loaded payload has no configured runtime owner."), ConfiguredSourceRoot);
        if (ConfiguredServiceName != serviceName)
            throw new InvalidOperationException("The loaded payload's host service does not match its runtime owner.");
        if (ConfiguredLane == "installed" && (!SameSourceRoot(ConfiguredInstalledRoot, ProductRuntimeLayout.ForCurrentUser().RootPath) || string.IsNullOrWhiteSpace(ConfiguredExecutablePath)))
            throw new InvalidOperationException("The loaded payload has no verified canonical installation owner.");
        var discovered = PeServiceDiscovery.TryDiscover(ProductRuntimeLayout.ForCurrentUser().RootPath, serviceName)
            ?? throw new InvalidOperationException($"No running '{serviceName}' host for the loaded payload.");
        if (discovered.Lane != ConfiguredLane || (ConfiguredLane == "dev" ? !SameSourceRoot(discovered.SourceRoot, ConfiguredSourceRoot) : !string.IsNullOrWhiteSpace(discovered.SourceRoot)))
            throw new InvalidOperationException("The host service receipt does not match the loaded payload's runtime owner.");
        if (ConfiguredLane == "installed" && !SameSourceRoot(discovered.ExecutablePath, ConfiguredExecutablePath))
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
        if ((string?)status["lane"] != ConfiguredLane || (string?)status["serviceName"] != serviceName || (int?)status["processId"] != discovered.Pid
            || (ConfiguredLane == "dev" ? !SameSourceRoot((string?)status["sourceRoot"], ConfiguredSourceRoot)
                : !string.IsNullOrWhiteSpace((string?)status["sourceRoot"]) || !SameSourceRoot((string?)status["installedRoot"], ConfiguredInstalledRoot) || !SameSourceRoot((string?)status["executablePath"], ConfiguredExecutablePath)))
            throw new InvalidOperationException("The host listener does not match the loaded payload's runtime owner.");
        return baseUrl;
    }

    public static string? ConfiguredServiceName { get; set; }
    public static string? ConfiguredLane { get; set; }
    public static string? ConfiguredSourceRoot { get; set; }
    public static string? ConfiguredInstalledRoot { get; set; }
    public static string? ConfiguredExecutablePath { get; set; }

    private static bool SameSourceRoot(string? left, string? right) =>
        !string.IsNullOrWhiteSpace(left) && !string.IsNullOrWhiteSpace(right)
        && PeServiceDiscovery.NormalizeSourceRoot(left!) == PeServiceDiscovery.NormalizeSourceRoot(right!);

    /// <param name="lane">The SDK lane string: <c>"installed"</c> or <c>"dev"</c>.</param>
    public static string ResolveServiceName(string lane, string? sourceRoot) {
        if (lane == "installed" && string.IsNullOrWhiteSpace(sourceRoot))
            return ServiceName;
        if (lane != "dev")
            throw new ArgumentException("A host requires a verified dev or installed lane.", nameof(lane));
        if (string.IsNullOrWhiteSpace(sourceRoot))
            throw new ArgumentException("A dev host requires a source root for service identity.", nameof(sourceRoot));
        return SourceServiceName(sourceRoot!);
    }

    public static string SourceServiceName(string sourceRoot) =>
        PeServiceDiscovery.SourceServiceName(ServiceName, sourceRoot);

    /// <summary>
    ///     The actual bound port from the SDK runtime service file, via the vendored
    ///     platform-neutral discovery client (<see cref="PeServiceDiscovery"/>). The service files
    ///     live under the product root, which is the one thing this transport still asks
    ///     <see cref="ProductRuntimeLayout"/> for. Liveness-checked: a crashed host's leftover file
    ///     reads as null, never as an address.
    /// </summary>

    private static string? FirstNonBlank(params string?[] values) =>
        values.FirstOrDefault(value => !string.IsNullOrWhiteSpace(value))?.Trim();
}
