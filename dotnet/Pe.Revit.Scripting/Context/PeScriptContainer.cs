using Autodesk.Revit.DB;
using Autodesk.Revit.UI;
using Pe.Revit.Scripting.Storage;

namespace Pe.Revit.Scripting.Context;

public abstract class PeScriptContainer {
    public RevitScriptContext Context { get; internal set; } = null!;

    protected UIApplication app => this.Context.App;
    protected UIDocument? uidoc => this.Context.UiDocument;
    protected Document? doc => this.Context.Document;
    protected IReadOnlyList<ElementId> selection => this.Context.Selection;
    protected string revitVersion => this.Context.RevitVersion;
    protected ScriptArtifactWriter Artifacts => this.Context.Artifacts;

    /// <summary>
    ///     Cooperative cancellation token: fires when the caller cancels or the execution timeout
    ///     elapses. Check it (or call <see cref="ThrowIfCancelled" />) inside loops — a script that
    ///     never observes it cannot be interrupted.
    /// </summary>
    protected CancellationToken ct => this.Context.CancellationToken;

    protected void ThrowIfCancelled() => this.Context.CancellationToken.ThrowIfCancellationRequested();

    /// <summary>
    ///     Returns a structured JSON result to the caller (the response's data field). May be called
    ///     once per execution. Use for machine-readable results; WriteLine for human-readable output.
    /// </summary>
    protected void Result(object? value) => this.Context.SetResult(value);

    protected void Notify(string message) => this.Context.Notify(message);

    protected void WriteLine(string message) => this.Context.WriteLine(message);

    public abstract void Execute();
}
