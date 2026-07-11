using Autodesk.Revit.DB;
using Autodesk.Revit.UI;
using Newtonsoft.Json.Linq;
using Pe.Revit.Scripting.Storage;

namespace Pe.Revit.Scripting.Context;

public sealed class RevitScriptContext(
    UIApplication app,
    UIDocument? uidoc,
    Document? doc,
    IReadOnlyList<ElementId> selection,
    string revitVersion,
    ScriptArtifactWriter artifacts,
    CancellationToken cancellationToken = default,
    Action<string>? outputWriter = null,
    Action<string>? notificationSink = null
) {
    private readonly Action<string>? _notificationSink = notificationSink;
    private readonly Action<string>? _outputWriter = outputWriter;
    private bool _resultSet;

    public UIApplication App { get; } = app;
    public UIDocument? UiDocument { get; } = uidoc;
    public Document? Document { get; } = doc;
    public IReadOnlyList<ElementId> Selection { get; } = selection;
    public string RevitVersion { get; } = revitVersion;
    public ScriptArtifactWriter Artifacts { get; } = artifacts;
    public CancellationToken CancellationToken { get; } = cancellationToken;

    /// <summary>Structured result set by the script via Result(...); returned as the response's data field.</summary>
    public JToken? ResultData { get; private set; }

    public void SetResult(object? value) {
        if (this._resultSet)
            throw new InvalidOperationException("Result(...) may only be called once per execution.");

        try {
            this.ResultData = value is null ? JValue.CreateNull() : JToken.FromObject(value);
        } catch (Exception ex) {
            throw new InvalidOperationException(
                $"Result(...) could not serialize the value to JSON: {ex.Message}. Pass a plain data object (anonymous type, dictionary, or DTO) without Revit API objects.",
                ex
            );
        }

        this._resultSet = true;
    }

    public void Notify(string message) {
        if (!string.IsNullOrWhiteSpace(message))
            this._notificationSink?.Invoke(message);
    }

    public void WriteLine(string message) =>
        this._outputWriter?.Invoke(message ?? string.Empty);
}
