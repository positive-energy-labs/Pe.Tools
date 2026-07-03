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

        var hostLaunchResult = EnsureTsHostRunning();
        if (!hostLaunchResult.Success) {
            return new HostBridgeConnectResult(
                false,
                false,
                hostLaunchResult,
                new RuntimeActionResult(false, hostLaunchResult.Message)
            );
        }

        var connectResult = ConnectRuntime();
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
