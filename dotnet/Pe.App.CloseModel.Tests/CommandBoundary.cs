// Only native UI and SDK observation/effect boundaries are simulated. CmdCloseModel is linked unchanged.
namespace Autodesk.Revit.Attributes {
    public enum TransactionMode { Manual }
    public sealed class TransactionAttribute(TransactionMode mode) : Attribute;
}
namespace Autodesk.Revit.DB {
    public sealed class ElementSet;
    public sealed class Document {
        public string Title => "Selected";
        public string PathName => "local.rvt";
        public bool IsModelInCloud => false;
    }
}
namespace Autodesk.Revit.UI {
    public enum Result { Succeeded, Cancelled, Failed }
    public enum TaskDialogCommonButtons { Cancel }
    public enum TaskDialogResult { Cancel = 0, CommandLink1 = 1001 }
    public enum TaskDialogCommandLinkId { CommandLink1 = 1001 }
    public interface IExternalCommand { Result Execute(ExternalCommandData data, ref string message, DB.ElementSet elements); }
    public sealed class ExternalCommandData { public UIApplication Application { get; } = new(); }
    public sealed class UIApplication { public UIDocument ActiveUIDocument { get; } = new(); }
    public sealed class UIDocument { public DB.Document Document { get; } = new(); }
    public sealed class TaskDialog(string title) {
        public static TaskDialog? Shown;
        public string? MainInstruction { get; set; }
        public string? MainContent { get; set; }
        public string? ExpandedContent { get; set; }
        public TaskDialogCommonButtons CommonButtons { get; set; }
        public TaskDialogResult DefaultButton { get; set; }
        public List<(string Title, string Detail)> Links { get; } = [];
        public void AddCommandLink(TaskDialogCommandLinkId id, string label, string detail) => Links.Add((label, detail));
        public TaskDialogResult Show() { Shown = this; return TaskDialogResult.Cancel; }
    }
}
namespace Serilog.Events { public enum LogEventLevel { Error } }
namespace Pe.Revit.Global.Ui {
    public sealed class Ballogger {
        public Ballogger Add(Serilog.Events.LogEventLevel level, object? context, string text) => this;
        public void Show() { }
    }
}
namespace Pe.Revit.Loader.Documents {
    public sealed record HeldElement(long Id, string? Category, string? Name, bool? ChangedSinceSync, IReadOnlyList<string> Requesters);
    public sealed record Holdings(bool Workshared, bool Unsaved, bool? SavedNotSynced,
        IReadOnlyList<HeldElement> Elements, IReadOnlyList<string> Worksets) {
        public static Holdings Observation = null!;
        public bool Empty => !Unsaved && (!Workshared || SavedNotSynced == false) && Elements.Count == 0 && Worksets.Count == 0;
        public static Holdings Read(Autodesk.Revit.DB.Document document) => Observation;
    }
    public enum CloseOutcome { SyncAndReleaseAll, SaveAndReleaseUnchanged, SaveAndKeepAll, DiscardAndReleaseUnchanged, Save, DontSave }
    public static class HoldingsClose {
        public static void Run(Autodesk.Revit.UI.UIApplication app, CloseOutcome outcome) => throw new InvalidOperationException("Cancel must not close");
    }
}
