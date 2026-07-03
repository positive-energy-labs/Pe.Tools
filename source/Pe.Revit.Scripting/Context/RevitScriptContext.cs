using Autodesk.Revit.DB;
using Autodesk.Revit.UI;
using Pe.Revit.Scripting.Storage;

namespace Pe.Revit.Scripting.Context;

public sealed class RevitScriptContext(
    UIApplication app,
    UIDocument? uidoc,
    Document? doc,
    IReadOnlyList<ElementId> selection,
    string revitVersion,
    ScriptArtifactWriter artifacts,
    Action<string>? outputWriter = null,
    Action<string>? notificationSink = null
) {
    private readonly Action<string>? _notificationSink = notificationSink;
    private readonly Action<string>? _outputWriter = outputWriter;

    public UIApplication App { get; } = app;
    public UIDocument? UiDocument { get; } = uidoc;
    public Document? Document { get; } = doc;
    public IReadOnlyList<ElementId> Selection { get; } = selection;
    public string RevitVersion { get; } = revitVersion;
    public ScriptArtifactWriter Artifacts { get; } = artifacts;

    public void Notify(string message) {
        if (!string.IsNullOrWhiteSpace(message))
            this._notificationSink?.Invoke(message);
    }

    public void WriteLine(string message) =>
        this._outputWriter?.Invoke(message ?? string.Empty);
}
