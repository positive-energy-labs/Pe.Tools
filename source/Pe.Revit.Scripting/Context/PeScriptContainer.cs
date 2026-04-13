using Autodesk.Revit.DB;
using Autodesk.Revit.UI;

namespace Pe.Revit.Scripting;

public abstract class PeScriptContainer {
    public RevitScriptContext Context { get; internal set; } = null!;

    protected UIApplication app => this.Context.App;
    protected UIDocument? uidoc => this.Context.UiDocument;
    protected Document? doc => this.Context.Document;
    protected IReadOnlyList<ElementId> selection => this.Context.Selection;
    protected string revitVersion => this.Context.RevitVersion;

    protected void Notify(string message) => this.Context.Notify(message);

    protected void WriteLine(string message) => this.Context.WriteLine(message);

    public abstract void Execute();
}
