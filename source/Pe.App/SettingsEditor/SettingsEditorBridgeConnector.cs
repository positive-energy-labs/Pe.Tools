using Pe.Revit.Global.Services.Host;

namespace Pe.Tools.SettingsEditor;

internal sealed record SettingsEditorBridgeConnectResult(
    bool Success,
    bool AlreadyConnected,
    SettingsEditorHostLaunchResult HostLaunchResult,
    RuntimeActionResult RuntimeActionResult
);

internal static class SettingsEditorBridgeConnector {
    public static SettingsEditorBridgeConnectResult EnsureConnected() {
        var status = HostRuntime.GetStatus();
        if (status.IsConnected) {
            return new SettingsEditorBridgeConnectResult(
                true,
                true,
                new SettingsEditorHostLaunchResult(true, true, false, "Bridge is connected."),
                new RuntimeActionResult(true, "Bridge is already connected.")
            );
        }

        var hostLaunchResult = SettingsEditorHostLauncher.EnsureRunning();
        if (!hostLaunchResult.Success) {
            return new SettingsEditorBridgeConnectResult(
                false,
                false,
                hostLaunchResult,
                new RuntimeActionResult(false, hostLaunchResult.Message)
            );
        }

        var connectResult = HostRuntime.Connect();
        return new SettingsEditorBridgeConnectResult(
            connectResult.Success,
            false,
            hostLaunchResult,
            connectResult
        );
    }
}
