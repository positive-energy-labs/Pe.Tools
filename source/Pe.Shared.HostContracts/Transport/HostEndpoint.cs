using Pe.Revit.ServiceClient;
using Pe.Shared.Product;

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

    public static string? ConfiguredServiceName { get; set; }

    /// <param name="lane">The SDK lane string: <c>"installed"</c> or <c>"dev"</c>.</param>
    public static string ResolveServiceName(string lane, string? sourceRoot) {
        if (lane == "installed")
            return ServiceName;
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
    private static string? TryReadServiceFileBaseUrl() {
        try {
            var serviceName = FirstNonBlank(
                ConfiguredServiceName,
                Environment.GetEnvironmentVariable(ServiceNameVariable),
                ServiceName
            )!;
            var discovered = PeServiceDiscovery.TryDiscover(
                ProductRuntimeLayout.ForCurrentUser().RootPath,
                serviceName
            );
            return discovered is null ? null : $"http://127.0.0.1:{discovered.Port}";
        } catch {
            return null;
        }
    }

    private static string? FirstNonBlank(params string?[] values) =>
        values.FirstOrDefault(value => !string.IsNullOrWhiteSpace(value))?.Trim();
}
