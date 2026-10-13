using Autodesk.Revit.Attributes;
using Autodesk.Revit.DB;
using Autodesk.Revit.UI;
using Pe.Revit.Global.Ui;
using Pe.Revit.Loader.Documents;
using Serilog.Events;

namespace Pe.App.Commands;

/// <summary>
/// Close the active model after showing everything the user holds in it, by place: unsaved in Revit, saved on
/// this PC but not synced, owned in central. State read now, never history (SDK <see cref="Holdings"/>).
/// A TaskDialog has at most four command links, so a link that would do the same as another is left out.
/// </summary>
[Transaction(TransactionMode.Manual)]
public class CmdCloseModel : IExternalCommand {
    private const int ListCap = 100;

    public Result Execute(ExternalCommandData commandData, ref string message, ElementSet elements) {
        try {
            var ui = commandData.Application;
            var document = ui.ActiveUIDocument?.Document;
            if (document is null) return Result.Cancelled;
            var holdings = Holdings.Read(document);
            var links = Links(document, holdings);
            var dialog = new TaskDialog($"Close {document.Title}") {
                MainInstruction = holdings.Empty ? $"Close {document.Title}?" : $"You hold work in {document.Title}",
                MainContent = Summary(document, holdings),
                ExpandedContent = Details(holdings),
                CommonButtons = TaskDialogCommonButtons.Cancel,
                DefaultButton = TaskDialogResult.Cancel
            };
            for (var i = 0; i < links.Count; i++)
                dialog.AddCommandLink((TaskDialogCommandLinkId)((int)TaskDialogCommandLinkId.CommandLink1 + i), links[i].Title, links[i].Detail);
            var picked = (int)dialog.Show() - (int)TaskDialogResult.CommandLink1;
            if (picked < 0 || picked >= links.Count) return Result.Cancelled;
            HoldingsClose.Run(ui, links[picked].Outcome);
            return Result.Succeeded;
        } catch (Exception ex) {
            new Ballogger().Add(LogEventLevel.Error, null, $"Close failed; the model is still open. {ex.Message}").Show();
            return Result.Failed;
        }
    }

    private sealed record Link(CloseOutcome Outcome, string Title, string Detail);

    private static List<Link> Links(Document document, Holdings h) {
        if (!h.Workshared) {
            if (!h.Unsaved) return [new Link(CloseOutcome.DontSave, "Close", "Nothing is unsaved.")];
            return string.IsNullOrEmpty(document.PathName)
                ? [new Link(CloseOutcome.DontSave, "Don't save", "Unsaved changes are lost. This model was never saved to a file.")]
                : [
                    new Link(CloseOutcome.Save, "Save", "Write the changes to the file."),
                    new Link(CloseOutcome.DontSave, "Don't save", "Unsaved changes are lost.")
                ];
        }
        if (h.Empty) return [new Link(CloseOutcome.SaveAndKeepAll, "Close", "You hold nothing in this model.")];
        var unchanged = h.Elements.Count(e => e.ChangedSinceSync != true) + h.Worksets.Count;
        var links = new List<Link> {
            new(CloseOutcome.SyncAndReleaseAll, "Sync and give back everything",
                $"Your changes go to {Central(document)}. Nothing stays yours.")
        };
        if (unchanged > 0)
            links.Add(new Link(CloseOutcome.SaveAndReleaseUnchanged, "Save here, give back what hasn't changed",
                "Your changes wait on this PC. Everything not changed since your last sync is given back."));
        links.Add(new Link(CloseOutcome.SaveAndKeepAll, "Save here, keep everything",
            "Your changes wait on this PC." + (Owned(h) is { Length: > 0 } owned ? $" You keep {owned}." : "")));
        if (h.Unsaved)
            links.Add(new Link(CloseOutcome.DiscardAndReleaseUnchanged, "Discard unsaved changes",
                "Unsaved changes are lost. Saved changes stay on this PC. Everything not changed since your last sync is given back."));
        return links;
    }

    private static string Summary(Document document, Holdings h) {
        if (h.Empty) return "Nothing is unsaved, nothing on this PC waits to sync, and you own nothing.";
        var lines = new List<string>();
        if (h.Unsaved) lines.Add("In Revit: unsaved changes");
        if (h.SavedNotSynced == true) lines.Add("On this PC: saved changes, not synced");
        if (h.Elements.Count + h.Worksets.Count > 0) {
            var changed = h.Elements.Count(e => e.ChangedSinceSync == true);
            var unknown = h.Elements.Any(e => e.ChangedSinceSync is null);
            var asked = h.Elements.Count(e => e.Requesters.Count > 0);
            lines.Add($"In {Central(document)}: you own {Owned(h)}"
                      + (unknown ? "" : $"; {changed} changed since your last sync")
                      + (asked > 0 ? $"; others asked for {asked}" : ""));
        }
        return string.Join("\n", lines);
    }

    private static string? Details(Holdings h) {
        var rows = h.Elements.Select(e =>
                $"{e.Id}  {e.Category} · {e.Name}  ({e.ChangedSinceSync switch {
                    true => "changed since last sync", false => "not changed since last sync", null => "change unknown"
                }}{(e.Requesters.Count > 0 ? $"; asked for by {string.Join(", ", e.Requesters)}" : "")})")
            .Concat(h.Worksets.Select(w => $"Workset · {w}"))
            .ToList();
        if (rows.Count == 0) return null;
        return string.Join("\n", rows.Take(ListCap)) + (rows.Count > ListCap ? $"\n… and {rows.Count - ListCap} more" : "");
    }

    private static string Owned(Holdings h) =>
        string.Join(" and ", new[] {
            h.Elements.Count > 0 ? $"{h.Elements.Count} element{(h.Elements.Count == 1 ? "" : "s")}" : null,
            h.Worksets.Count > 0 ? $"{h.Worksets.Count} workset{(h.Worksets.Count == 1 ? "" : "s")}" : null
        }.Where(s => s is not null));

    private static string Central(Document document) => document.IsModelInCloud ? "the cloud" : "central";
}
