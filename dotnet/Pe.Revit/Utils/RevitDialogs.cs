using Autodesk.Revit.UI;
using Autodesk.Revit.UI.Events;
using Pe.Revit.Extensions.ProjDocument;

namespace Pe.Revit.Failures;

/// <summary>
///     The one dialog lane (user verdict 2026-09-17): an engine or a host read never leaves a Revit modal to whoever is at the
///     keyboard. Every dialog is answered and recorded. Session-only: it needs the UI application, so DA code never calls it.
/// </summary>
public static class RevitDialogs {
    /// <summary>
    ///     The dialogs the family and schedule engines can raise, keyed by `DialogId`, each with the answer that
    ///     changes nothing the spec did not ask for. Mirrors <c>FamilyFailurePolicy.KnownFailures</c>.
    ///     Census (w7-engine, 2026-09-17): the button sets are what Revit's own journals record for each id
    ///     (`%LOCALAPPDATA%/Autodesk/Revit/Autodesk Revit 2024-2026/Journals`, `'CommonButtons :` and
    ///     `Jrn.PushButton` lines), matched to the w4-revit defects 6 and 18 dialogs. Cancel is not a button on
    ///     most of them, so a blanket Cancel override is not an answer Revit can take.
    /// </summary>
    public static readonly IReadOnlyDictionary<string, (int Answer, string Button)> KnownDialogs = new Dictionary<string, (int, string)>(StringComparer.Ordinal) {
        // "0 Errors, N Warnings: Some dimensions were not copied…" during a family edit (w4-revit defect 6). Journal: Cancel is IDABORT; OK commits.
        ["Dialog_Revit_DocWarnDialog"] = (3, "Cancel"),
        // Error dialog with Cancel only (journal IDCANCEL).
        ["Dialog_Revit_ExtendedErrorDialog"] = ((int)TaskDialogResult.Cancel, "Cancel"),
        // Workshared model whose central is gone (w4-revit defect 18). RequireReachableCentral refuses first; this is the backstop. Close only.
        ["TaskDialog_Cannot_Find_Central_Model"] = ((int)TaskDialogResult.Close, "Close"),
        // "Making a workset editable now might put your file at risk" (w4-revit defect 18). Yes/No; No edits nothing.
        ["TaskDialog_Edit_Workset_At_Risk"] = ((int)TaskDialogResult.No, "No"),
        // LoadFamily over an existing family without load options. Cancel beside two command links (overwrite).
        ["TaskDialog_Family_Already_Exists"] = ((int)TaskDialogResult.Cancel, "Cancel"),
        // `Document.LoadFamily` failed (w4-revit apply). Close only.
        ["TaskDialog_Could_Not_Load_Family"] = ((int)TaskDialogResult.Close, "Close"),
        // A schedule spec with no field. Close only.
        ["TaskDialog_Schedule_Must_Contain_One_Field"] = ((int)TaskDialogResult.Close, "Close")
    };

    /// <summary>
    ///     Runs the engine with every Revit dialog answered by the engine and recorded. A known id takes its
    ///     census answer; an unknown id takes Cancel and the receipt names it, so the census can grow.
    /// </summary>
    public static T NoModal<T>(ICollection<(bool IsError, string Message)> handled, Func<T> run) {
        var ui = RevitUiSession.CurrentUIApplication;
        void OnDialog(object? sender, DialogBoxShowingEventArgs args) {
            var said = args switch {
                TaskDialogShowingEventArgs t => $": {t.Message}",
                MessageBoxShowingEventArgs m => $": {m.Message}",
                _ => ""
            };
            if (KnownDialogs.TryGetValue(args.DialogId, out var known)) {
                handled.Add((false, $"Answered Revit dialog '{args.DialogId}' with {known.Button}{said}"));
                args.OverrideResult(known.Answer);
                return;
            }
            handled.Add((false, $"Dismissed unknown Revit dialog '{args.DialogId}' with Cancel{said}. Add it to RevitDialogs.KnownDialogs."));
            args.OverrideResult((int)TaskDialogResult.Cancel);
        }

        ui.DialogBoxShowing += OnDialog;
        try { return run(); }
        finally { ui.DialogBoxShowing -= OnDialog; }
    }

}
