using Autodesk.Revit.Attributes;
using Autodesk.Revit.UI;
using Pe.App.Host;
using Pe.Revit.Global.Services.Host;
using Pe.Revit.Scripting.Bootstrap;
using Pe.Revit.Scripting.Context;
using Pe.Revit.Scripting.References;
using Pe.Shared.HostContracts;
using Pe.Shared.HostContracts.Scripting;
using Pe.Shared.Product;
using Pe.Shared.StorageRuntime;
using Serilog;
using System.Diagnostics;
using System.IO;
using System.Text;

namespace Pe.App.Commands.PeTools;

[Transaction(TransactionMode.Manual)]
public class CmdPeTools : IExternalCommand {
    private const string DefaultWorkspaceKey = "default";

    public Result Execute(ExternalCommandData commandData, ref string message, ElementSet elements) {
        try {
            var status = HostRuntime.GetStatus();
            var connectAttempt = EnsureConnectedForButtonOpen(status);
            status = HostRuntime.GetStatus();
            Log.Information(
                "Pe Tools command opened: IsConnected={IsConnected}, BridgeUri={BridgeUri}, Modules={ModuleCount}, ActiveDocument={ActiveDocumentTitle}, ConnectAttempted={ConnectAttempted}, ConnectSuccess={ConnectSuccess}, ConnectMessage={ConnectMessage}",
                status.IsConnected,
                status.BridgeUri,
                status.AvailableModuleCount,
                status.ActiveDocumentTitle,
                connectAttempt != null,
                connectAttempt?.Success,
                connectAttempt?.RuntimeActionResult.Message
            );
            var dialog = new TaskDialog("Pe Tools Launcher") {
                MainInstruction = status.IsConnected
                    ? "Pe Tools Bridge: Connected"
                    : "Pe Tools Bridge: Connection Failed",
                MainContent = BuildStatusSummary(status, connectAttempt?.RuntimeActionResult),
                CommonButtons = TaskDialogCommonButtons.Close,
                FooterText = status.IsConnected
                    ? "The bridge is maintained automatically while Revit is running."
                    : "Opening Pe Tools attempts to start the TS host and reconnect the bridge automatically."
            };

            if (status.IsConnected) {
                dialog.AddCommandLink(
                    TaskDialogCommandLinkId.CommandLink1,
                    "Open Scripting Workspace",
                    "Bootstrap the default Revit scripting workspace and open it in your default IDE."
                );
                dialog.AddCommandLink(
                    TaskDialogCommandLinkId.CommandLink2,
                    "Open Pea Agent Terminal",
                    "Launch `pea agent` in a terminal window."
                );
                dialog.AddCommandLink(
                    TaskDialogCommandLinkId.CommandLink3,
                    "Open Pe Tools Browser",
                    "Open the external Pe Tools frontend in your default browser."
                );
            }

            var result = dialog.Show();
            if (!status.IsConnected)
                return Result.Succeeded;

            switch (result) {
            case TaskDialogResult.CommandLink1:
                ShowActionResult("Scripting Workspace", OpenScriptingWorkspace(commandData.Application));
                break;
            case TaskDialogResult.CommandLink2:
                _ = PeaTerminalLauncher.LaunchAgent();
                break;
            case TaskDialogResult.CommandLink3:
                ShowActionResult("Pe Tools Browser", OpenPeToolsBrowser());
                break;
            }

            return Result.Succeeded;
        } catch (Exception ex) {
            Log.Error(ex, "Pe Tools command failed.");
            message = ex.Message;
            return Result.Failed;
        }
    }

    private static HostBridgeConnectResult? EnsureConnectedForButtonOpen(RuntimeStatus status) {
        if (status.IsConnected)
            return null;

        var actionStopwatch = Stopwatch.StartNew();
        Log.Information("Pe Tools command attempting host bridge connect on open.");
        var connectResult = HostBridgeConnector.EnsureConnected();
        Log.Information(
            "Pe Tools command host bridge connect on open completed: Success={Success}, AlreadyConnected={AlreadyConnected}, ElapsedMs={ElapsedMs}, Message={Message}",
            connectResult.Success,
            connectResult.AlreadyConnected,
            actionStopwatch.ElapsedMilliseconds,
            connectResult.RuntimeActionResult.Message
        );
        return connectResult;
    }

    internal static RuntimeActionResult OpenScriptingWorkspace(UIApplication uiApplication) {
        EnsureBridgeConnected();
        var bootstrapResult = BootstrapWorkspace(uiApplication);
        var openPath = ResolveOpenPath(bootstrapResult);
        if (!FileUtils.OpenInDefaultApp(openPath)) {
            var openFailureMessage = $"Bootstrapped the scripting workspace but could not open:\n{openPath}";
            Log.Warning("Revit scripting workspace command could not open path: {Path}", openPath);
            return new RuntimeActionResult(false, openFailureMessage);
        }

        Log.Information(
            "Revit scripting workspace command opened workspace target: Workspace={WorkspaceKey}, Path={Path}",
            bootstrapResult.WorkspaceKey,
            openPath
        );
        return new RuntimeActionResult(true, "Opened the default scripting workspace.");
    }

    private static void EnsureBridgeConnected() {
        var connectResult = HostBridgeConnector.EnsureConnected();
        if (connectResult.Success) {
            Log.Information(
                "Revit scripting workspace ensured host bridge connection: AlreadyConnected={AlreadyConnected}, Message={Message}",
                connectResult.AlreadyConnected,
                connectResult.RuntimeActionResult.Message
            );
            return;
        }

        throw new InvalidOperationException(connectResult.RuntimeActionResult.Message);
    }

    private static ScriptWorkspaceBootstrapData BootstrapWorkspace(UIApplication uiApplication) {
        var revitVersion = uiApplication.Application.VersionNumber ?? "unknown";
        var targetFramework = ResolveTargetFramework(revitVersion);
        var runtimeAssemblyPath = typeof(PeScriptContainer).Assembly.Location;
        var bootstrapService = new ScriptWorkspaceBootstrapService(new ScriptProjectGenerator(new CsProjReader()));

        return bootstrapService.Bootstrap(
            DefaultWorkspaceKey,
            true,
            revitVersion,
            targetFramework,
            runtimeAssemblyPath
        );
    }

    private static string ResolveOpenPath(ScriptWorkspaceBootstrapData bootstrapResult) {
        if (!string.IsNullOrWhiteSpace(bootstrapResult.ProjectFilePath) && File.Exists(bootstrapResult.ProjectFilePath))
            return bootstrapResult.ProjectFilePath;

        if (!string.IsNullOrWhiteSpace(bootstrapResult.WorkspaceRootPath))
            return bootstrapResult.WorkspaceRootPath;

        throw new InvalidOperationException("Bootstrap did not return a valid workspace path.");
    }

    private static string ResolveTargetFramework(string revitVersion) =>
        int.TryParse(revitVersion, out var numericVersion) && numericVersion < 2025
            ? "net48"
            : "net8.0-windows";



    private static RuntimeActionResult OpenPeToolsBrowser() {
        Log.Information("Pe Tools command selected action: Open Pe Tools Browser");
        var connectResult = HostBridgeConnector.EnsureConnected();
        if (!connectResult.Success)
            return connectResult.RuntimeActionResult;

        var launched = PeToolsBrowser.TryLaunch();
        Log.Information("Pe Tools browser launch result: Success={Success}", launched);
        return new RuntimeActionResult(
            launched,
            launched
                ? "Opened the external Pe Tools frontend in your default browser."
                : $"Could not open the external Pe Tools frontend. Check {HostProcessIdentity.FrontendBaseUrlVariable}."
        );
    }

    private static void ShowActionResult(string actionName, RuntimeActionResult result) {
        Log.Information(
            "Pe Tools app launch completed: ActionName={ActionName}, Success={Success}, Message={Message}",
            actionName,
            result.Success,
            result.Message
        );
        _ = TaskDialog.Show("Pe Tools", result.Message);
    }

    private static string BuildStatusSummary(RuntimeStatus status, RuntimeActionResult? connectAttempt) {
        var sb = new StringBuilder();
        if (!status.IsConnected)
            _ = sb.AppendLine($"Status: {connectAttempt?.Message ?? status.LastError ?? "Connection attempt is pending."}");

        _ = sb.AppendLine($"Bridge: {status.BridgeUri}");
        _ = sb.AppendLine($"Process: {status.ProcessId}");
        _ = sb.AppendLine($"Modules: {status.AvailableModuleCount}");
        _ = sb.AppendLine($"Revit: {status.RevitVersion ?? "Unknown"}");
        _ = sb.AppendLine($"Runtime: {status.RuntimeFramework ?? "Unknown"}");
        _ = sb.AppendLine($"Active document: {status.ActiveDocumentTitle ?? "None"}");
        if (!status.IsConnected) {
            _ = sb.AppendLine();
            _ = sb.AppendLine("Unavailable until connected:");
            _ = sb.AppendLine("- Open Scripting Workspace");
            _ = sb.AppendLine("- Open Pea Agent Terminal");
            _ = sb.AppendLine("- Open Pe Tools Browser");
        }

        if (!string.IsNullOrWhiteSpace(status.LastError)) {
            _ = sb.AppendLine();
            _ = sb.AppendLine($"Last error: {status.LastError}");
        }

        return sb.ToString();
    }
}
