using Pe.Revit.Global.Services.Host;

namespace Pe.App.Host;

internal sealed record HostBridgeConnectResult(
    bool Success,
    bool AlreadyConnected,
    PeHostLaunchResult HostLaunchResult,
    RuntimeActionResult RuntimeActionResult
);

internal static class HostBridgeConnector {
    public static HostBridgeConnectResult EnsureConnected() {
        var status = HostRuntime.GetStatus();
        if (status.IsConnected) {
            return new HostBridgeConnectResult(
                true,
                true,
                new PeHostLaunchResult(true, true, false, "Bridge is connected."),
                new RuntimeActionResult(true, "Bridge is already connected.")
            );
        }

        var hostLaunchResult = PeHostLauncher.EnsureRunning();
        if (!hostLaunchResult.Success) {
            return new HostBridgeConnectResult(
                false,
                false,
                hostLaunchResult,
                new RuntimeActionResult(false, hostLaunchResult.Message)
            );
        }

        var connectResult = HostRuntime.Connect();
        return new HostBridgeConnectResult(
            connectResult.Success,
            false,
            hostLaunchResult,
            connectResult
        );
    }
}
