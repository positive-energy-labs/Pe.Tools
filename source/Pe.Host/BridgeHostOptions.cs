using Pe.Shared.HostContracts;
using Pe.Shared.Product;

namespace Pe.Host;

public sealed record BridgeHostOptions(
    string HostBaseUrl,
    IReadOnlyList<string> AllowedOrigins,
    bool IdleShutdownEnabled,
    TimeSpan IdleShutdownTimeout
) {
    public static BridgeHostOptions FromEnvironment() =>
        new(
            HostProcessIdentity.ResolveHostBaseUrl(),
            BuildAllowedOrigins(HostProcessIdentity.ResolveFrontendBaseUrl()),
            HostRuntimeDefaults.DefaultIdleShutdownEnabled,
            HostRuntimeDefaults.DefaultIdleShutdownTimeout
        );

    private static IReadOnlyList<string> BuildAllowedOrigins(string frontendBaseUrl) => [
        .. new[] {
                frontendBaseUrl, HostProcessIdentity.DefaultFrontendBaseUrl, "http://localhost:5173",
                "http://localhost:3000", "http://127.0.0.1:5150", "http://127.0.0.1:5173", "http://127.0.0.1:3000"
            }
            .Distinct(StringComparer.OrdinalIgnoreCase)
    ];

}
