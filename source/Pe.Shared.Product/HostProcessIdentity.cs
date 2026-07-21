using Pe.Revit.ServiceClient;

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

    /// <summary>
    ///     Process-local service-name pin set by the lane-aware launcher (TsHostLauncher) so the
    ///     platform-neutral callers here (bridge, /call client) read THIS runtime's service file.
    ///     Deliberately a static, NOT an environment variable: env vars leak to child processes
    ///     (e.g. an installed sandbox spawned from a dev session) and would pin them to the wrong
    ///     worktree. Only the stable NAME is pinned — the port is re-read from the service file on
    ///     every resolve, so a host takeover/restart can never leave a stale address behind.
    /// </summary>
    public static string? ConfiguredServiceName { get; set; }

    public static string ResolveServiceName(ProductRuntimeLane lane, string? sourceRoot) {
        if (lane == ProductRuntimeLane.Installed)
            return ServiceName;
        if (string.IsNullOrWhiteSpace(sourceRoot))
            throw new ArgumentException("A dev host requires a source root for service identity.", nameof(sourceRoot));
        return SourceServiceName(sourceRoot!);
    }

    /// <summary>Worktree-scoped dev-host name — the hash is SDK-owned (vendored
    /// <see cref="PeServiceDiscovery"/>, byte-stable with the TS client via contract vectors).</summary>
    public static string SourceServiceName(string sourceRoot) =>
        PeServiceDiscovery.SourceServiceName(ServiceName, sourceRoot);

    /// <summary>
    ///     The actual bound port from the SDK runtime service file, via the vendored
    ///     platform-neutral discovery client (<see cref="PeServiceDiscovery"/> — the D8 answer:
    ///     Pe.Shared.Product cannot reference the Revit-flavored Pe.Revit.Loader, so the SDK ships
    ///     this read-only client for exactly this seam). Liveness-checked: a crashed host's
    ///     leftover file reads as null, never as an address.
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
