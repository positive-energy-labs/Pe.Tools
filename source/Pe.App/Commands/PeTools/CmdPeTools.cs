using Autodesk.Revit.Attributes;
using Autodesk.Revit.UI;
using Pe.App.Host;
using Pe.Revit.Global.Services.Host;
using Pe.Shared.HostContracts;
using Pe.Shared.Product;
using Serilog;
using System.Diagnostics;
using System.Text;

namespace Pe.App.Commands.PeTools;

[Transaction(TransactionMode.Manual)]
public class CmdPeTools : IExternalCommand {
    public Result Execute(ExternalCommandData commandData, ref string message, ElementSet elements) {
        try {
            var status = HostRuntime.GetStatus();
            Log.Information(
                "Pe Tools command opened: IsConnected={IsConnected}, BridgeUri={BridgeUri}, SessionId={SessionId}, Modules={ModuleCount}, ActiveDocument={ActiveDocumentTitle}",
                status.IsConnected,
                status.BridgeUri,
                status.SessionId,
                status.AvailableModuleCount,
                status.ActiveDocumentTitle
            );
            var dialog = new TaskDialog("Pe Tools") {
                MainInstruction = status.IsConnected
                    ? "Pe Tools Bridge: Connected"
                    : "Pe Tools Bridge: Disconnected",
                MainContent = BuildStatusSummary(status),
                CommonButtons = TaskDialogCommonButtons.Close,
                FooterText = "Revit can start the external host automatically when needed."
            };

            if (status.IsConnected) {
                dialog.AddCommandLink(
                    TaskDialogCommandLinkId.CommandLink1,
                    "Disconnect Bridge",
                    "Stop serving host bridge requests from this Revit session."
                );
                dialog.AddCommandLink(
                    TaskDialogCommandLinkId.CommandLink2,
                    "Open Pe Tools",
                    "Open the external Pe Tools frontend in your default browser."
                );
            } else {
                dialog.AddCommandLink(
                    TaskDialogCommandLinkId.CommandLink1,
                    "Connect Bridge",
                    "Connect this Revit session to the manually launched host."
                );
                dialog.AddCommandLink(
                    TaskDialogCommandLinkId.CommandLink2,
                    "Open Pe Tools",
                    "Open the external Pe Tools frontend in your default browser."
                );
            }

            var result = dialog.Show();
            switch (result) {
            case TaskDialogResult.CommandLink1:
                var actionName = status.IsConnected ? "Disconnect Bridge" : "Connect Bridge";
                var actionStopwatch = Stopwatch.StartNew();
                Log.Information("Pe Tools command selected action: {ActionName}", actionName);
                var actionResult = status.IsConnected
                    ? HostRuntime.Disconnect()
                    : HostBridgeConnector.EnsureConnected().RuntimeActionResult;
                Log.Information(
                    "Pe Tools command action completed: {ActionName}, Success={Success}, ElapsedMs={ElapsedMs}, Message={Message}",
                    actionName,
                    actionResult.Success,
                    actionStopwatch.ElapsedMilliseconds,
                    actionResult.Message
                );
                _ = TaskDialog.Show("Pe Tools", actionResult.Message);
                break;
            case TaskDialogResult.CommandLink2:
                Log.Information("Pe Tools command selected action: Open Pe Tools");
                var browserHostLaunchResult = PeHostLauncher.EnsureRunning();
                Log.Information(
                    "Host ensure result before browser launch: Success={Success}, AlreadyRunning={AlreadyRunning}, StartedProcess={StartedProcess}, Message={Message}",
                    browserHostLaunchResult.Success,
                    browserHostLaunchResult.AlreadyRunning,
                    browserHostLaunchResult.StartedProcess,
                    browserHostLaunchResult.Message
                );
                if (!browserHostLaunchResult.Success) {
                    _ = TaskDialog.Show("Pe Tools", browserHostLaunchResult.Message);
                    break;
                }

                var launched = PeToolsBrowser.TryLaunch(sessionId: status.SessionId);
                Log.Information("Pe Tools launch result: Success={Success}", launched);
                _ = TaskDialog.Show(
                    "Pe Tools",
                    launched
                        ? "Opened the external Pe Tools frontend in your default browser."
                        : $"Could not open the external Pe Tools frontend. Check {HostProcessIdentity.FrontendBaseUrlVariable}."
                );
                break;
            }

            return Result.Succeeded;
        } catch (Exception ex) {
            Log.Error(ex, "Pe Tools command failed.");
            message = ex.Message;
            return Result.Failed;
        }
    }

    private static string BuildStatusSummary(RuntimeStatus status) {
        var sb = new StringBuilder();
        _ = sb.AppendLine($"Bridge: {status.BridgeUri}");
        _ = sb.AppendLine($"Session: {status.SessionId}");
        _ = sb.AppendLine($"Process: {status.ProcessId}");
        _ = sb.AppendLine($"Modules: {status.AvailableModuleCount}");
        _ = sb.AppendLine($"Revit: {status.RevitVersion ?? "Unknown"}");
        _ = sb.AppendLine($"Runtime: {status.RuntimeFramework ?? "Unknown"}");
        _ = sb.AppendLine($"Active document: {status.ActiveDocumentTitle ?? "None"}");

        if (!string.IsNullOrWhiteSpace(status.LastError)) {
            _ = sb.AppendLine();
            _ = sb.AppendLine($"Last error: {status.LastError}");
        }

        return sb.ToString();
    }
}
