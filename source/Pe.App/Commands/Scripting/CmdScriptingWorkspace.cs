using System.IO;
using Autodesk.Revit.Attributes;
using Autodesk.Revit.UI;
using Pe.Tools.SettingsEditor;
using Pe.Revit.Scripting;
using Pe.Revit.Scripting.Bootstrap;
using Pe.Revit.Scripting.References;
using Pe.Shared.HostContracts.Scripting;
using Pe.Shared.StorageRuntime;
using Serilog;

namespace Pe.Tools.Commands.Scripting;

[Transaction(TransactionMode.Manual)]
public class CmdScriptingWorkspace : IExternalCommand {
    private const string CommandTitle = "Revit Scripting";
    private const string DefaultWorkspaceKey = "default";

    public Result Execute(ExternalCommandData commandData, ref string message, ElementSet elements) {
        try {
            Log.Information("Revit scripting workspace command started.");
            EnsureBridgeConnected();
            var bootstrapResult = BootstrapWorkspace(commandData.Application);
            var openPath = ResolveOpenPath(bootstrapResult);
            if (!FileUtils.OpenInDefaultApp(openPath)) {
                var openFailureMessage = $"Bootstrapped the scripting workspace but could not open:\n{openPath}";
                Log.Warning("Revit scripting workspace command could not open path: {Path}", openPath);
                _ = TaskDialog.Show(CommandTitle, openFailureMessage);
                return Result.Succeeded;
            }

            Log.Information(
                "Revit scripting workspace command opened workspace target: Workspace={WorkspaceKey}, Path={Path}",
                bootstrapResult.WorkspaceKey,
                openPath
            );
            return Result.Succeeded;
        } catch (Exception ex) {
            Log.Error(ex, "Revit scripting workspace command failed.");
            message = ex.Message;
            _ = TaskDialog.Show(CommandTitle, $"Failed to launch the scripting workspace:\n{ex.Message}");
            return Result.Failed;
        }
    }

    private static void EnsureBridgeConnected() {
        var connectResult = SettingsEditorBridgeConnector.EnsureConnected();
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
            createSampleScript: true,
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
}
