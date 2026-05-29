using Autodesk.Revit.DB;
using Autodesk.Revit.UI;
using Pe.Revit.Scripting.Storage;
using Pe.Shared.HostContracts;

namespace Pe.Revit.Scripting.Context;

public abstract class PeScriptContainer {
    public RevitScriptContext Context { get; internal set; } = null!;

    protected UIApplication app => this.Context.App;
    protected UIDocument? uidoc => this.Context.UiDocument;
    protected Document? doc => this.Context.Document;
    protected IReadOnlyList<ElementId> selection => this.Context.Selection;
    protected string revitVersion => this.Context.RevitVersion;
    protected PeHostClient Host => this.Context.Host;
    protected ScriptArtifactWriter Artifacts => this.Context.Artifacts;

    protected void Notify(string message) => this.Context.Notify(message);

    protected void WriteLine(string message) => this.Context.WriteLine(message);

    public abstract void Execute();
}