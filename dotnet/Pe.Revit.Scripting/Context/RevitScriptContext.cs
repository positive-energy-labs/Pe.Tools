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
    Action<string>? notificationSink = null,
    JObject? input = null,
    string? podFolder = null
) {
    private const int MaxResultCharacters = 1024 * 1024;

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

    /// <summary>The caller's arguments; an empty object when none were sent.</summary>
    public JObject Input { get; } = input ?? new JObject();

    /// <summary>The absolute folder of the running Pod, as the host named it; null for an inline run.</summary>
    public string? PodFolder { get; } = podFolder;

    /// <summary>One argument by name. A missing one throws unless a fallback is given; an ill-typed one always throws.</summary>
    public T Arg<T>(string name, bool hasFallback = false, T fallback = default!) {
        var token = this.Input.GetValue(name, StringComparison.OrdinalIgnoreCase);
        if (token is null || token.Type == JTokenType.Null)
            return hasFallback
                ? fallback
                : throw new ArgumentException($"This script needs the argument '{name}' ({typeof(T).Name}), and the input has none. Pass it as input: {{ \"{name}\": ... }}.");
        try {
            return token.ToObject<T>() is { } value
                ? value
                : throw new Newtonsoft.Json.JsonException("it converts to null");
        } catch (Exception ex) when (ex is Newtonsoft.Json.JsonException or FormatException or InvalidCastException or ArgumentException or OverflowException) {
            throw new ArgumentException($"The argument '{name}' must be a {typeof(T).Name}; the input has {token.ToString(Newtonsoft.Json.Formatting.None)}. {ex.Message}");
        }
    }

    /// <summary>
    ///     The absolute path of a file the running Pod carries. The live file, not the bytes the run captured.
    ///     Refuses a path that leaves the Pod (by `..`, a rooted path, or a link) and a file that is not there.
    /// </summary>
    public string PodFile(string relativePath) => this.PodFolder is null
        ? throw new InvalidOperationException("this script runs outside a Pod; PodFile names a file of the Pod a declared entrypoint runs from.")
        : Pods.ScriptPodPreparationService.MemberFile(this.PodFolder, relativePath);

    /// <summary>Structured result set by the script via Result(...); returned as the response's data field.</summary>
    public JToken? ResultData { get; private set; }

    public void SetResult(object? value) {
        if (this._resultSet)
            throw new InvalidOperationException("Result(...) may only be called once per execution.");

        try {
            var result = value is null ? JValue.CreateNull() : JToken.FromObject(value);
            if (result.ToString(Newtonsoft.Json.Formatting.None).Length > MaxResultCharacters)
                throw new InvalidOperationException(
                    "Result(...) exceeds the 1 MiB limit. Write large data with Artifacts instead."
                );
            this.ResultData = result;
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
