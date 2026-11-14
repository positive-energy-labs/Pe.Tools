using Autodesk.Revit.DB;
using Autodesk.Revit.UI;
using Newtonsoft.Json.Linq;
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

    /// <summary>The caller's arguments as sent: one JSON object, empty when none. Prefer <see cref="Arg{T}(string)" />.</summary>
    protected JObject Input => this.Context.Input;

    /// <summary>A required argument. Throws in plain words when it is missing or not a <typeparamref name="T" />.</summary>
    protected T Arg<T>(string name) => this.Context.Arg<T>(name);

    /// <summary>An optional argument: <paramref name="fallback" /> when it is missing. An ill-typed one still throws.</summary>
    protected T Arg<T>(string name, T fallback) => this.Context.Arg(name, true, fallback);

    /// <summary>
    ///     The absolute path of a file this script's Pod carries, e.g. <c>PodFile("assets/tap.rfa")</c>. Throws for
    ///     an inline run, which has no Pod, and for a path that leaves the Pod.
    /// </summary>
    protected string PodFile(string relativePath) => this.Context.PodFile(relativePath);

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
