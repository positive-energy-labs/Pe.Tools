using Pe.Shared.Product;

namespace Pe.Shared.HostContracts;

public static class HostRuntimeDefaults {
    public const int DefaultHostStartupTimeoutMs = 8000;
    public const int DefaultHostProbeTimeoutMs = 5000;
    public const int DefaultBridgeConnectTimeoutMs = 1500;
    public const int DefaultHostRegistrationTimeoutMs = 4000;
    public const bool DefaultIdleShutdownEnabled = true;
    public static readonly TimeSpan DefaultIdleShutdownTimeout = TimeSpan.FromMinutes(10);

    public static bool ResolveHostAutoStartEnabled(bool debuggerAttached) {
        var configuredValue = Environment.GetEnvironmentVariable(HostProcessIdentity.HostAutoStartEnabledVariable);
        if (bool.TryParse(configuredValue, out var isEnabled))
            return isEnabled;

        return !debuggerAttached;
    }
}
