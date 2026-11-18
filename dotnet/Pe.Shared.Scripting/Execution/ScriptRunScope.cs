using Pe.Shared.HostContracts.Scripting;

namespace Pe.Shared.Scripting.Execution;

/// <summary>What a Revit pre-event says is about to be written.</summary>
public enum ScriptSaveKind {
    Save,
    SaveAsNewPath,
    SaveAsOverExisting,
    Synchronize
}

/// <summary>
///     Carries the script caller through Revit's API context (ADR 0038 rule 5).
///     The scope also keeps what it held, so
///     the run's result can say so. Revit's API is single-threaded, so the current scope is one static.
/// </summary>
public sealed class ScriptRunScope : IDisposable {
    private readonly List<(ScriptSaveKind Kind, string Title)> _held = [];
    private readonly ScriptRunScope? _outer;
    private readonly ScriptCaller _caller;
    private bool _disposed;

    private ScriptRunScope(ScriptCaller caller) {
        this._caller = caller;
        this._outer = Current;
        Current = this;
    }

    public static ScriptRunScope? Current { get; private set; }

    public static ScriptRunScope Enter(ScriptCaller caller) => new(caller);

    /// <summary>
    ///     Guards 1 and 2 cover project documents only (ADR 0038 rule 3), and a save-as to a new path
    ///     overwrites nothing, so neither is held. Outside a run nothing is held: that save is the person's.
    /// </summary>
    public static bool Holds(ScriptSaveKind kind, bool isFamilyDocument) =>
        IsAgentRun && !isFamilyDocument && kind != ScriptSaveKind.SaveAsNewPath;

    /// <summary>True inside a run no person started: nobody is at the keyboard for it, so its dialogs are answered for it.</summary>
    public static bool IsAgentRun => Current is { _caller: not ScriptCaller.Person };

    public void RecordHeld(ScriptSaveKind kind, string title) => this._held.Add((kind, title));

    /// <summary>
    ///     The one reason for everything this run held, in the host's held wording
    ///     (`held` in ts/packages/agent-contracts/src/guards.ts); null when nothing was held.
    /// </summary>
    public string? Held => this._held.Count == 0
        ? null
        : "Held, not done: " + string.Join(" ", this._held.Distinct().Select(held =>
              held.Kind == ScriptSaveKind.Synchronize
                  ? $"Synchronizing with central is the person's act, and project document '{held.Title}' was not touched. The person presses Synchronize in Revit."
                  : $"Overwriting or discarding the model's state is the person's act, and project document '{held.Title}' was not touched. The person presses Save in Revit."))
          + " The person has not been asked and has not said no: carry on with the rest of the work and tell them this is waiting on them.";

    public void Dispose() {
        if (this._disposed)
            return;
        this._disposed = true;
        Current = this._outer;
    }
}
