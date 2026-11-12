using Autodesk.Revit.ApplicationServices;
using Autodesk.Revit.DB;
using Autodesk.Revit.DB.Events;
using Pe.Shared.Scripting.Execution;
using Serilog;

namespace Pe.Revit.Scripting.Execution;

/// <summary>
///     The Revit half of guards 1 and 2 (ADR 0038 rule 5): one subscriber on the three cancellable
///     pre-events. It cancels a project save or synchronize that fires inside a <see cref="ScriptRunScope" />
///     and records it there, so the run's result reports "held". Desktop only: the app registers it.
/// </summary>
public static class ScriptSaveHold {
    public static void Register(ControlledApplication application) {
        application.DocumentSaving += OnSaving;
        application.DocumentSavingAs += OnSavingAs;
        application.DocumentSynchronizingWithCentral += OnSynchronizing;
    }

    /// <summary>The same subscriber on a running Application, for a caller that must take it off again.</summary>
    public static IDisposable Register(Application application) {
        application.DocumentSaving += OnSaving;
        application.DocumentSavingAs += OnSavingAs;
        application.DocumentSynchronizingWithCentral += OnSynchronizing;
        return new Registration(() => {
            application.DocumentSaving -= OnSaving;
            application.DocumentSavingAs -= OnSavingAs;
            application.DocumentSynchronizingWithCentral -= OnSynchronizing;
        });
    }

    private static void OnSaving(object? sender, DocumentSavingEventArgs args) =>
        Hold(args, args.Document, ScriptSaveKind.Save);

    private static void OnSavingAs(object? sender, DocumentSavingAsEventArgs args) =>
        Hold(args, args.Document,
            File.Exists(args.PathName) ? ScriptSaveKind.SaveAsOverExisting : ScriptSaveKind.SaveAsNewPath);

    private static void OnSynchronizing(object? sender, DocumentSynchronizingWithCentralEventArgs args) =>
        Hold(args, args.Document, ScriptSaveKind.Synchronize);

    private static void Hold(RevitAPIPreEventArgs args, Document document, ScriptSaveKind kind) {
        if (!ScriptRunScope.Holds(kind, document.IsFamilyDocument))
            return;
        if (!args.Cancellable) {
            Log.Warning("A script's {Kind} of project document {Title} could not be held: Revit raised it as not cancellable.", kind, document.Title);
            return;
        }
        args.Cancel();
        ScriptRunScope.Current!.RecordHeld(kind, document.Title);
    }

    private sealed class Registration(Action remove) : IDisposable {
        public void Dispose() => remove();
    }
}
