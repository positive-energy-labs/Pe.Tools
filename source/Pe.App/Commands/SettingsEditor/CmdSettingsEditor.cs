using Autodesk.Revit.Attributes;
using Autodesk.Revit.UI;
using Pe.Revit.Global.Services.Host;
using Pe.Tools.SettingsEditor;
using Serilog;
using System.Diagnostics;
using System.Text;

namespace Pe.Tools.Commands.SettingsEditor;

[Transaction(TransactionMode.Manual)]
public class CmdSettingsEditor : IExternalCommand {
    public Result Execute(ExternalCommandData commandData, ref string message, ElementSet elements) {
        try {
            var status = HostRuntime.GetStatus();
            Log.Information(
                "Settings editor command opened: IsConnected={IsConnected}, Pipe={PipeName}, SessionId={SessionId}, Modules={ModuleCount}, ActiveDocument={ActiveDocumentTitle}",
                status.IsConnected,
                status.PipeName,
                status.SessionId,
                status.AvailableModuleCount,
                status.ActiveDocumentTitle
            );
            var dialog = new TaskDialog("Settings Editor") {
                MainInstruction = status.IsConnected
                    ? "Settings Editor Bridge: Connected"
                    : "Settings Editor Bridge: Disconnected",
                MainContent = BuildStatusSummary(status),
                CommonButtons = TaskDialogCommonButtons.Close,
                FooterText = "Revit can start the external settings editor host automatically when needed."
            };

            if (status.IsConnected) {
                dialog.AddCommandLink(
                    TaskDialogCommandLinkId.CommandLink1,
                    "Disconnect Bridge",
                    "Stop serving settings-editor requests from this Revit session."
                );
                dialog.AddCommandLink(
                    TaskDialogCommandLinkId.CommandLink2,
                    "Open Settings Editor",
                    "Open the external settings-editor frontend in your default browser."
                );
            } else {
                dialog.AddCommandLink(
                    TaskDialogCommandLinkId.CommandLink1,
                    "Connect Bridge",
                    "Connect this Revit session to the manually launched settings editor host."
                );
                dialog.AddCommandLink(
                    TaskDialogCommandLinkId.CommandLink2,
                    "Open Settings Editor",
                    "Open the external settings-editor frontend in your default browser."
                );
            }

            var result = dialog.Show();
            switch (result) {
            case TaskDialogResult.CommandLink1:
                var actionName = status.IsConnected ? "Disconnect Bridge" : "Connect Bridge";
                var actionStopwatch = Stopwatch.StartNew();
                Log.Information("Settings editor command selected action: {ActionName}", actionName);
                var hostLaunchResult = status.IsConnected
                    ? new SettingsEditorHostLaunchResult(true, true, false, "Bridge is connected.")
                    : SettingsEditorHostLauncher.EnsureRunning();
                Log.Information(
                    "Settings editor host ensure result: Success={Success}, AlreadyRunning={AlreadyRunning}, StartedProcess={StartedProcess}, Message={Message}",
                    hostLaunchResult.Success,
                    hostLaunchResult.AlreadyRunning,
                    hostLaunchResult.StartedProcess,
                    hostLaunchResult.Message
                );
                if (!hostLaunchResult.Success) {
                    _ = TaskDialog.Show("Settings Editor", hostLaunchResult.Message);
                    break;
                }

                var actionResult = status.IsConnected
                    ? HostRuntime.Disconnect()
                    : HostRuntime.Connect();
                Log.Information(
                    "Settings editor command action completed: {ActionName}, Success={Success}, ElapsedMs={ElapsedMs}, Message={Message}",
                    actionName,
                    actionResult.Success,
                    actionStopwatch.ElapsedMilliseconds,
                    actionResult.Message
                );
                _ = TaskDialog.Show("Settings Editor", actionResult.Message);
                break;
            case TaskDialogResult.CommandLink2:
                Log.Information("Settings editor command selected action: Open Settings Editor");
                var browserHostLaunchResult = SettingsEditorHostLauncher.EnsureRunning();
                Log.Information(
                    "Settings editor host ensure result before browser launch: Success={Success}, AlreadyRunning={AlreadyRunning}, StartedProcess={StartedProcess}, Message={Message}",
                    browserHostLaunchResult.Success,
                    browserHostLaunchResult.AlreadyRunning,
                    browserHostLaunchResult.StartedProcess,
                    browserHostLaunchResult.Message
                );
                if (!browserHostLaunchResult.Success) {
                    _ = TaskDialog.Show("Settings Editor", browserHostLaunchResult.Message);
                    break;
                }

                var launched = SettingsEditorBrowser.TryLaunch(sessionId: status.SessionId);
                Log.Information("Settings editor launch result: Success={Success}", launched);
                _ = TaskDialog.Show(
                    "Settings Editor",
                    launched
                        ? "Opened the external settings editor in your default browser."
                        : $"Could not open the external settings editor. Check {Pe.Shared.HostContracts.Protocol.SettingsEditorRuntime.FrontendBaseUrlVariable}."
                );
                break;
            }

            return Result.Succeeded;
        } catch (Exception ex) {
            Log.Error(ex, "Settings editor command failed.");
            message = ex.Message;
            return Result.Failed;
        }
    }

    private static string BuildStatusSummary(RuntimeStatus status) {
        var sb = new StringBuilder();
        _ = sb.AppendLine($"Pipe: {status.PipeName}");
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
