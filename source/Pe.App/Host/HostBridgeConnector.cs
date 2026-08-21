using Pe.Revit.Global.Services.Host;

namespace Pe.App.Host;

internal sealed record HostBridgeConnectResult(
    bool Success,
    bool AlreadyConnected,
    TsHostLaunchResult HostLaunchResult,
    RuntimeActionResult RuntimeActionResult
);

internal static class HostBridgeConnector {
    public static HostBridgeConnectResult EnsureConnected() {
        var status = HostRuntime.GetStatus();
        if (status.IsConnected) {
            return new HostBridgeConnectResult(
                true,
                true,
                new TsHostLaunchResult(true, true, false, "Bridge is connected."),
                new RuntimeActionResult(true, "Bridge is already connected.")
            );
        }

        // A failed EnsureRunning is advice, not a verdict: connect to whatever the service file
        // names and let the socket decide (see BridgeConnectionSupervisor.TryConnectAsync).
        var hostLaunchResult = EnsureTsHostRunning();
        var connectResult = ConnectRuntime();
        if (!connectResult.Success && !hostLaunchResult.Success)
            connectResult = new RuntimeActionResult(false, $"{connectResult.Message} (host launch: {hostLaunchResult.Message})");
        return new HostBridgeConnectResult(
            connectResult.Success,
            false,
            hostLaunchResult,
            connectResult
        );
    }

    public static TsHostLaunchResult EnsureTsHostRunning() => TsHostLauncher.EnsureRunning();

    public static RuntimeActionResult ConnectRuntime() => HostRuntime.Connect();
}
