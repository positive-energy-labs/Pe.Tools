using Autodesk.Revit.DB;
using Autodesk.Revit.UI;
using Autodesk.Revit.UI.Events;
using Pe.Revit.Global.Services.Document;
using Pe.Revit.Scripting.Pods;
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
///     `schedule.apply`); the dialog lane is `RevitDialogs.NoModal`, which host reads use too; this edge owns
///     the pre-edit refusals, so nothing double-handles one `FailuresProcessing` event.
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

    /// <summary>The run file the verdict asks for: what Revit said, and what the engine answered.</summary>
    internal static IEnumerable<(string name, byte[] bytes)> WarningsOutput(IReadOnlyCollection<(bool IsError, string Message)> handled) =>
        handled.Count == 0 ? [] : [("warnings.json", System.Text.Encoding.UTF8.GetBytes(
            Newtonsoft.Json.JsonConvert.SerializeObject(handled.Select(h => new { severity = h.IsError ? "error" : "warning", message = h.Message }),
                Newtonsoft.Json.Formatting.Indented)))];

    /// <summary>
    ///     The run's first write, before any effect. Captured bytes that disagree with their hash, or a root pod that
    ///     does not resolve, refuse the call here and only here: nothing after an effect maps to a refusal.
    /// </summary>
    internal static (string Run, List<string> Inputs) StartRun(PodComposedSource source, object metadata, string consumedJson, string? planActionId = null) {
        try { return PodRuns.StartComposedRun(source, metadata, consumedJson, planActionId); }
        catch (InvalidDataException exception) { throw BridgeOperationExceptions.BadRequest(exception.Message); }
    }

    /// <summary>The document a run acts on, with the tracker's open id when it has one.</summary>
    internal static object RunTarget(Document document) {
        var tracked = DocumentTrackerAccessor.Current?.Find(document);
        return new {
            kind = document.IsFamilyDocument ? "family-document" : "project-document",
            openId = tracked?.OpenId(),
            document.Title,
            path = string.IsNullOrWhiteSpace(document.PathName) ? null : document.PathName,
            process = ProcessEvidence(),
            unavailableEvidence = tracked is null ? new[] { "document tracker openId" } : Array.Empty<string>()
        };
    }

    internal static object ProcessEvidence() {
        using var process = System.Diagnostics.Process.GetCurrentProcess();
        return new { processId = process.Id, processStartUtc = process.StartTime.ToUniversalTime() };
    }
}
