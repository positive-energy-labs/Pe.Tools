using Autodesk.Revit.DB;
using Autodesk.Revit.UI;
using Autodesk.Revit.UI.Events;
using Pe.Revit.Ui.Core;
using Pe.Shared.HostContracts.Operations;
using System.IO;

namespace Pe.App.Host;

/// <summary>
///     The one edge every engine crosses before it opens a family document or writes to a model.
///     User verdict (2026-09-17): the engine always handles Revit warnings, never shows a modal, and the
///     receipt records them. A modal is not a decision the engine may hand to whoever happens to be at the
///     keyboard — a headless session has nobody, and an agent session has somebody who did not ask.
///     The failures lane is already owned per document (`FamilyVisit`, `ReadFamilyCopy`, and now
///     `schedule.apply`); this edge owns the dialog lane and the pre-edit refusals, so nothing double-handles
///     one `FailuresProcessing` event.
/// </summary>
internal static class EngineEdge {
    /// <summary>
    ///     A workshared model whose central is unreachable blocks mid-edit on a Revit TaskDialog
    ///     (w4-revit defect 18). Refuse before editing: the answer is the user's, and it is not "Cancel".
    /// </summary>
    internal static void RequireReachableCentral(Document document) {
        if (!document.IsWorkshared || document.IsDetached) return;
        var central = document.GetWorksharingCentralModelPath();
        if (central is null)
            throw BridgeOperationExceptions.Conflict(
                $"'{document.Title}' is workshared and names no central model. Reconnect it or open a detached copy; an engine never answers a Revit modal for you.");
        // A cloud or Revit Server central answers reachability itself, without a modal.
        if (central.ServerPath) return;
        var path = ModelPathUtils.ConvertModelPathToUserVisiblePath(central);
        if (!File.Exists(path))
            throw BridgeOperationExceptions.Conflict(
                $"'{document.Title}' is workshared and its central '{path}' is unreachable. Reconnect to it or work on a detached copy.");
    }

    /// <summary>
    ///     Runs the engine with every Revit dialog answered by the engine and recorded. Cancel is the answer,
    ///     because it is the only one that changes nothing the spec did not ask for.
    /// </summary>
    internal static T NoModal<T>(ICollection<(bool IsError, string Message)> handled, Func<T> run) {
        var ui = RevitUiSession.CurrentUIApplication;
        void OnDialog(object? sender, DialogBoxShowingEventArgs args) {
            handled.Add((false, $"Dismissed Revit dialog '{args.DialogId}' with Cancel."));
            args.OverrideResult((int)TaskDialogResult.Cancel);
        }

        ui.DialogBoxShowing += OnDialog;
        try { return run(); }
        finally { ui.DialogBoxShowing -= OnDialog; }
    }

    /// <summary>The run file the verdict asks for: what Revit said, and what the engine answered.</summary>
    internal static IEnumerable<(string name, byte[] bytes)> WarningsOutput(IReadOnlyCollection<(bool IsError, string Message)> handled) =>
        handled.Count == 0 ? [] : [("warnings.json", System.Text.Encoding.UTF8.GetBytes(
            Newtonsoft.Json.JsonConvert.SerializeObject(handled.Select(h => new { severity = h.IsError ? "error" : "warning", message = h.Message }),
                Newtonsoft.Json.Formatting.Indented)))];
}
