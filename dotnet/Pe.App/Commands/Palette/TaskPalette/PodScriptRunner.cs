using Autodesk.Revit.UI;
using Pe.Revit.Scripting.Execution;
using Pe.Revit.Scripting.Pods;
using Pe.Shared.HostContracts.Scripting;
using Serilog;

namespace Pe.App.Commands.Palette.TaskPalette;

/// <summary>
///     Runs a pod entrypoint from the palette through the same scripting pipeline the bridge
///     uses (policy, compile, permission guard). Palette actions already execute on the Revit
///     lane, so the execution service is called directly — no external-event round trip, and no
///     host callback. A host-local capture must complete before native execution begins.
/// </summary>
internal static class PodScriptRunner {
    public static void Run(UIApplication uiapp, PodScriptTaskItem item, ScriptPermissionMode permissionMode) {
        var modeLabel = permissionMode == ScriptPermissionMode.ReadOnly
            ? "safe — changes discarded"
            : "full — can modify model";
        Console.WriteLine($"Running script '{item.TextPrimary}' ({modeLabel})");

        try {
            var admitted = new ScriptPodPreparationService().Capture(item.PodId);
            if (admitted.Capture is not { } capture) {
                Log.Warning("{Code}: {Reason}", admitted.Code, admitted.Reason);
                Console.WriteLine($"{admitted.Code}: {admitted.Reason}");
                return;
            }
            if (!capture.Contributions.Any(row => row.Key == item.Key && row.MemberPath == item.Entrypoint.SourcePath))
                throw new InvalidOperationException("The selected palette script is no longer admitted.");
            var result = RevitScriptExecutionService.CreateDefault(() => uiapp).Execute(
                uiapp.ActiveUIDocument?.Document,
                new ExecuteRevitScriptRequest(
                    SourcePath: item.Entrypoint.SourcePath,
                    WorkspaceKey: capture.Folder,
                    SourceBundle: capture.SourceBundle,
                    PermissionMode: permissionMode
                ),
                Guid.NewGuid().ToString("N")
            );

            if (!string.IsNullOrWhiteSpace(result.Output))
                Console.WriteLine(result.Output.TrimEnd());
            foreach (var diagnostic in result.Diagnostics.Where(d => d.Severity != ScriptDiagnosticSeverity.Info))
                Console.WriteLine($"{diagnostic.Severity} {diagnostic.Stage}: {diagnostic.Message}");
            Console.WriteLine($"Script '{item.TextPrimary}' finished: {result.Status}\n");
        } catch (Exception ex) {
            Log.Error(ex, "Palette pod script failed: {PodTask}", item.Id);
            Console.WriteLine($"Script '{item.TextPrimary}' failed: {ex.Message}\n");
        }
    }
}
